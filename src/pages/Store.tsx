import { useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import toast from 'react-hot-toast'
import QRCode from 'react-qr-code'

interface Flavor {
  id: string
  name: string
  icon: string
}

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
  name: string
  icon: string
  flavorName?: string
  flavorIcon?: string
  price: number
  quantity: number
}

const MUFFIN_FLAVORS: Flavor[] = [
  { id: 'nuez', name: 'Nuez', icon: String.fromCodePoint(0x1F95C) },
  { id: 'almendra', name: 'Almendra', icon: String.fromCodePoint(0x1F330) },
  { id: 'arandano', name: 'Arándano', icon: String.fromCodePoint(0x1FAD0) },
  { id: 'chispas', name: 'Chispas de chocolate', icon: String.fromCodePoint(0x1F36B) },
  { id: 'nutella', name: 'Nutella', icon: String.fromCodePoint(0x1F36B) + String.fromCodePoint(0x2728) },
  { id: 'goober', name: 'Goober (fresa con cacahuate)', icon: String.fromCodePoint(0x1F353) + String.fromCodePoint(0x1F95C) }
]

const PRODUCTS: Product[] = [
  {
    id: 'muffin_platano',
    name: 'Muffins de plátano',
    icon: String.fromCodePoint(0x1F34C),
    price: 15,
    description: 'Deliciosos muffins caseros. Elige un sabor por pieza.',
    requiresFlavor: true
  },
  {
    id: 'mini_pays_queso',
    name: 'Mini pays de queso',
    icon: String.fromCodePoint(0x1F967),
    price: 15,
    description: '2 por $15 (1 bolsa incluye 2 pays)',
    requiresFlavor: false
  }
]

export default function Store() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedFlavor, setSelectedFlavor] = useState<string>('')
  
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
    const cartItemId = product.requiresFlavor ? `${product.id}-${selectedFlavor}` : product.id

    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId)
      if (existing) {
        return prev.map(item =>
          item.id === cartItemId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }

      const newItem: any = {
        id: cartItemId,
        productId: product.id,
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
        const newQty = item.quantity + delta
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
      const shortId = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase()
      
      const orderData = {
        shortId,
        customerName,
        customerPhone,
        items: cart,
        total,
        status: 'nuevo',
        isPaid: false,
        createdAt: serverTimestamp()
      }

      await addDoc(collection(db, 'orders'), orderData)
      
      setOrderId(shortId)
      setOrderSuccess(true)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      toast.success('¡Orden enviada con éxito!', { id: toastId })

    } catch (error) {
      console.error("Error adding document: ", error)
      toast.error('Ocurrió un error al enviar tu orden.', { id: toastId })
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
                  {MUFFIN_FLAVORS.map(flavor => (
                    <option key={flavor.id} value={flavor.id}>
                      {flavor.icon} {flavor.name}
                    </option>
                  ))}
                </select>
              )}
              
              <button 
                className="add-btn" 
                onClick={() => handleAddToCart(product)}
                disabled={product.requiresFlavor && !selectedFlavor}
              >
                <span>{String.fromCodePoint(0x2795)}</span> Agregar al carrito
              </button>
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
