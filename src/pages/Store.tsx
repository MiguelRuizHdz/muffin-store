import { useState, useEffect } from 'react'
import { collection, serverTimestamp, onSnapshot, query, runTransaction, doc } from 'firebase/firestore'
import { db } from '../firebase'
import toast from 'react-hot-toast'
import QRCode from 'react-qr-code'
import { AlertCircle } from 'lucide-react'


interface Product {
  id: string
  name: string
  icon: string
  price: number
  description: string
  requiresFlavor: boolean
}

interface CartItem {
  id: string
  productId: string
  inventoryId: string // Item to decrement stock from
  name: string
  icon: string
  flavorName?: string
  flavorIcon?: string
  price: number
  quantity: number
}

export default function Store() {
  const [inventory, setInventory] = useState<any[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedFlavor, setSelectedFlavor] = useState<string>('')
  const [orderType, setOrderType] = useState<'today' | 'tomorrow'>('today')
  const [globalLimitTomorrow, setGlobalLimitTomorrow] = useState(false)
  
  // Real-time inventory
  useEffect(() => {
    const q = query(collection(db, 'inventory'))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })
    return () => unsubscribe()
  }, [])

  // Configuración global
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'config'), (d) => {
      if (d.exists()) setGlobalLimitTomorrow(!!d.data().globalLimitTomorrow)
    })
    return () => unsub()
  }, [])

  // Limpiar carrito al cambiar tipo de pedido
  const handleOrderTypeChange = (type: 'today' | 'tomorrow') => {
    if (cart.length > 0 && !window.confirm('Cambiar el tipo de pedido vaciará tu carrito actual. ¿Continuar?')) {
      return
    }
    setOrderType(type)
    setCart([])
  }

  // Derived data
  const MUFFIN_FLAVORS = inventory.filter(i => i.type === 'flavor')
  
  // Base products (we'll keep the muffin base entry for now but it could be in DB too)
  const PRODUCTS: Product[] = [
    {
      id: 'muffin_platano',
      name: 'Muffins de plátano',
      icon: '🍌',
      price: 15,
      description: 'Deliciosos muffins caseros. Elige un sabor por pieza.',
      requiresFlavor: true
    },
    {
      id: 'product_mini_pays',
      name: 'Mini pays de queso',
      icon: '🧀',
      price: inventory.find(i => i.id === 'product_mini_pays')?.price || 15,
      description: '2 por $15 (1 bolsa incluye 2 pays)',
      requiresFlavor: false
    },
    ...inventory.filter(i => i.type === 'product' && i.id !== 'product_mini_pays').map(i => ({
      id: i.id,
      name: i.name,
      icon: i.icon,
      price: i.price,
      description: '',
      requiresFlavor: false
    }))
  ]
  
  const shouldLimit = (inventoryId: string) => {
    if (orderType === 'today') return true
    const item = inventory.find(i => i.id === inventoryId)
    return globalLimitTomorrow || (item && !!item.limitTomorrow)
  }

  // Customer Details
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  
  // Checkout State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderId, setOrderId] = useState('')

  const handleAddToCart = (product: Product) => {
    if (product.requiresFlavor && !selectedFlavor) {
      toast.error('Por favor selecciona un sabor para tu muffin.')
      return
    }

    const flavor = MUFFIN_FLAVORS.find(f => f.id === selectedFlavor)
    const inventoryId = product.requiresFlavor ? selectedFlavor : product.id
    const inventoryItem = inventory.find(i => i.id === inventoryId)
    const isLimited = shouldLimit(inventoryId)

    // Para pedidos con límite, validar stock.
    if (isLimited && (!inventoryItem || inventoryItem.stock <= 0)) {
      toast.error('Lo sentimos, este producto se ha agotado para este periodo.')
      return
    }

    const cartItemId = product.requiresFlavor ? `${product.id}-${selectedFlavor}` : product.id

    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId)
      if (existing) {
        if (isLimited && inventoryItem && existing.quantity + 1 > inventoryItem.stock) {
          toast.error(`Solo quedan ${inventoryItem.stock} disponibles.`)
          return prev
        }
        return prev.map(item =>
          item.id === cartItemId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }

      const newItem: CartItem = {
        id: cartItemId,
        productId: product.id,
        inventoryId: inventoryId,
        name: product.name,
        icon: product.icon,
        price: product.price,
        quantity: 1
      }
      if (flavor) {
        newItem.flavorName = flavor.name
        newItem.flavorIcon = flavor.icon
      }

      toast.success(`Agregado: ${product.name}`)
      return [...prev, newItem]
    })

    if (product.requiresFlavor) {
      setSelectedFlavor('')
    }
  }

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const inventoryItem = inventory.find(i => i.id === item.inventoryId)
        const newQty = item.quantity + delta
        const isLimited = shouldLimit(item.inventoryId)
        
        if (isLimited && delta > 0 && inventoryItem && newQty > inventoryItem.stock) {
          toast.error(`Solo quedan ${inventoryItem.stock} disponibles.`)
          return item
        }
        
        return newQty > 0 ? { ...item, quantity: newQty } : item
      }
      return item
    }))
  }

  const removeItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id))
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cart.length === 0) return
    if (!customerName || !customerPhone) {
      toast.error('Por favor ingresa tu nombre y número telefónico.')
      return
    }

    setIsSubmitting(true)
    const toastId = toast.loading('Procesando orden...')

    try {
      // Usar transacción para verificar stock y decrementar
      await runTransaction(db, async (transaction) => {
        const itemsToLimit = cart.filter(item => shouldLimit(item.inventoryId))
        let inventorySnapshots: any[] = []

        if (itemsToLimit.length > 0) {
          inventorySnapshots = await Promise.all(
            itemsToLimit.map(item => transaction.get(doc(db, 'inventory', item.inventoryId)))
          )

          // Verificación de stock
          for (let i = 0; i < itemsToLimit.length; i++) {
            const item = itemsToLimit[i]
            const snap = inventorySnapshots[i]
            if (!snap.exists()) continue // O manejar error
            const currentStock = snap.data().stock
            if (currentStock < item.quantity) {
              throw new Error(`¡Ups! Stock insuficiente para "${item.flavorName || item.name}". Solo quedan ${currentStock}.`)
            }
          }

          // Decrementar stock
          itemsToLimit.forEach((item, idx) => {
            const snap = inventorySnapshots[idx]
            const newStock = snap.data().stock - item.quantity
            transaction.update(doc(db, 'inventory', item.inventoryId), { stock: newStock })
          })
        }

        // Crear orden
        const shortId = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase()
        const orderData = {
          shortId,
          customerName,
          customerPhone,
          items: cart,
          total,
          status: 'nuevo',
          isPaid: false,
          orderType, // 'today' | 'tomorrow'
          createdAt: serverTimestamp()
        }
        
        const orderRef = doc(collection(db, 'orders'))
        transaction.set(orderRef, orderData)
        setOrderId(shortId)
      })
      
      setOrderSuccess(true)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      toast.success('¡Orden enviada con éxito!', { id: toastId })

    } catch (error: any) {
      console.error("Error en checkout: ", error)
      toast.error(error.message || 'Ocurrió un error al enviar tu orden.', { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (orderSuccess) {
    return (
      <div className="app-container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
        <h2>¡Orden Recibida!</h2>
        <p>Gracias por tu compra. Tu número de orden es:</p>
        <div style={{ 
          background: 'var(--surface)', 
          padding: '1.5rem', 
          borderRadius: '12px', 
          fontFamily: 'monospace',
          fontSize: '1.8rem',
          margin: '1.5rem auto',
          maxWidth: '300px',
          color: 'var(--primary)',
          letterSpacing: '2px',
          fontWeight: 'bold',
          boxShadow: '0 4px 6px rgba(0,0,0,0.05)'
        }}>
          #{orderId}
        </div>
        
        <div style={{ margin: '1rem auto 2.5rem', background: 'white', padding: '1rem', display: 'inline-block', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          {(() => {
             const QRCodeComponent = (typeof QRCode === 'object' && 'default' in (QRCode as any)) ? (QRCode as any).default : QRCode;
             return <QRCodeComponent value={orderId} size={150} level="M" />
          })()}
        </div>

        <button 
          className="checkout-btn" 
          onClick={() => setOrderSuccess(false)}
          style={{ width: 'auto', padding: '0.8rem 2rem', display: 'block', margin: '0 auto' }}
        >
          Hacer otro pedido
        </button>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header>
        <h1>Delicias Bakery</h1>
        <p>Los mejores postres caseros a tu alcance {String.fromCodePoint(0x1F9C1)}</p>
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', padding: '0.5rem', background: 'var(--surface)', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
        <button 
          onClick={() => handleOrderTypeChange('today')}
          style={{ 
            flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: orderType === 'today' ? 'var(--primary)' : 'transparent',
            color: orderType === 'today' ? 'white' : 'var(--text)',
            fontWeight: 600, transition: 'all 0.2s'
          }}
        >
          🔥 Disponible Hoy
        </button>
        <button 
          onClick={() => handleOrderTypeChange('tomorrow')}
          style={{ 
            flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: orderType === 'tomorrow' ? 'var(--primary)' : 'transparent',
            color: orderType === 'tomorrow' ? 'white' : 'var(--text)',
            fontWeight: 600, transition: 'all 0.2s'
          }}
        >
          📅 Pedido para Mañana
        </button>
      </div>

      <div className="grid">
        {PRODUCTS.map(product => (
          <div key={product.id} className="card">
            <div className="card-header">
              <div className="card-title">
                <span>{product.icon}</span>
                {product.name}
              </div>
              <div className="card-price">${product.price}</div>
            </div>
            
            <p className="card-desc">{product.description}</p>
            
            <div className="controls">
              {product.requiresFlavor && (
                <select 
                  className="flavor-select"
                  value={selectedFlavor}
                  onChange={(e) => setSelectedFlavor(e.target.value)}
                >
                  <option value="" disabled>Selecciona un sabor...</option>
                  {MUFFIN_FLAVORS.map(flavor => {
                    const isLimited = shouldLimit(flavor.id)
                    return (
                      <option key={flavor.id} value={flavor.id} disabled={isLimited && flavor.stock <= 0}>
                        {flavor.icon} {flavor.name} {isLimited ? (flavor.stock <= 0 ? '(AGOTADO)' : `(${flavor.stock} disponibles)`) : ''}
                      </option>
                    )
                  })}
                </select>
              )}
              
              {(() => {
                const inventoryId = product.requiresFlavor ? selectedFlavor : product.id
                const invItem = inventory.find(i => i.id === inventoryId)
                const isLimited = shouldLimit(inventoryId)
                const isOutOfStock = isLimited && invItem && invItem.stock <= 0
                
                return (
                  <>
                    {isOutOfStock && (
                      <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertCircle size={14} /> Producto temporalmente agotado
                      </div>
                    )}
                    <button 
                      className="add-btn" 
                      onClick={() => handleAddToCart(product)}
                      disabled={(product.requiresFlavor && !selectedFlavor) || isOutOfStock}
                      style={{ opacity: isOutOfStock ? 0.6 : 1 }}
                    >
                      <span>{String.fromCodePoint(0x2795)}</span> {isOutOfStock ? 'Agotado' : 'Agregar al carrito'}
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        ))}
      </div>

      <div className="cart-section">
        <h2 className="cart-title">{String.fromCodePoint(0x1F6D2)} Tu Pedido</h2>
        
        {cart.length === 0 ? (
          <div className="cart-empty">
            Tu carrito está vacío. ¡Agrega unos deliciosos postres!
          </div>
        ) : (
          <form onSubmit={handleCheckout}>
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.id} className="cart-item">
                  <div className="cart-item-info">
                    <span className="cart-item-name">
                      {item.icon} {item.name}
                    </span>
                    {item.flavorName && (
                      <span className="cart-item-flavor">
                        Sabor: {item.flavorName} {item.flavorIcon}
                      </span>
                    )}
                    <span className="cart-item-flavor" style={{ marginTop: '0.25rem', color: 'var(--primary)' }}>
                      ${item.price} c/u
                    </span>
                  </div>
                  
                  <div className="cart-item-actions">
                    <div className="quantity-control">
                      <button type="button" className="qty-btn" onClick={() => updateQuantity(item.id, -1)}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" className="qty-btn" onClick={() => updateQuantity(item.id, 1)}>+</button>
                    </div>
                    <button type="button" className="remove-btn" onClick={() => removeItem(item.id)}>{String.fromCodePoint(0x1F5D1, 0xFE0F)}</button>
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text)', marginBottom: '0.5rem' }}>Datos del cliente</h3>
              <input
                type="text"
                placeholder="Tu Nombre"
                required
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' }}
              />
              <input
                type="tel"
                placeholder="Teléfono / WhatsApp"
                required
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd', fontSize: '1rem' }}
              />
            </div>

            <div className="cart-summary">
              <div className="total-row">
                <span>Total:</span>
                <span style={{ color: 'var(--primary)' }}>${total}</span>
              </div>
              
              <button 
                type="submit" 
                className="checkout-btn" 
                disabled={isSubmitting}
                style={{ opacity: isSubmitting ? 0.7 : 1 }}
              >
                {isSubmitting ? 'Procesando...' : `Confirmar Pedido ($${total})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
