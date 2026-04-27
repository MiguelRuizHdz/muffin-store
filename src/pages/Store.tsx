import { useState, useEffect } from 'react'
import { collection, serverTimestamp, onSnapshot, query, runTransaction, doc } from 'firebase/firestore'
import { db } from '../firebase'
import toast from 'react-hot-toast'
import QRCode from 'react-qr-code'
import { AlertCircle } from 'lucide-react'
import { getNextBusinessDays, formatDateId, formatDisplayDate } from '../utils/dates'


interface SelectedOption {
  id: string
  name: string
  icon: string
  category: string
}

interface OptionGroup {
  label: string
  category: string
}

interface Product {
  id: string
  name: string
  icon: string
  price: number
  description: string
  optionGroups?: OptionGroup[]
}

interface CartItem {
  id: string
  productId: string
  name: string
  icon: string
  options: SelectedOption[]
  price: number
  quantity: number
}

export default function Store() {
  const [inventory, setInventory] = useState<any[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, string>>>({}) // { productId: { category: optionId } }
  
  const [visibleDays, setVisibleDays] = useState(5)
  const [availableDates, setAvailableDates] = useState<Date[]>(() => getNextBusinessDays(5))
  const [deliveryDate, setDeliveryDate] = useState(formatDateId(new Date()))
  const [dailyInventory, setDailyInventory] = useState<Record<string, number>>({})
  const [unlimitedItems, setUnlimitedItems] = useState<string[]>([])
  const [isUnlimitedDay, setIsUnlimitedDay] = useState(false)
  const [closedDate, setClosedDate] = useState('')
  const [storeName, setStoreName] = useState('Delicias Bakery')
  const [storeSubtitle, setStoreSubtitle] = useState('Los mejores postres caseros a tu alcance 🧁')
  
  // Real-time inventory
  useEffect(() => {
    const q = query(collection(db, 'inventory'))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })
    return () => unsubscribe()
  }, [])

  // Fetch settings for visible days and closed status
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'admin'), (d) => {
      if (d.exists()) {
        const data = d.data()
        if (data.visibleDays) setVisibleDays(data.visibleDays)
        if (data.closedDate) setClosedDate(data.closedDate)
        else setClosedDate('')
        if (data.storeName) setStoreName(data.storeName)
        if (data.storeSubtitle) setStoreSubtitle(data.storeSubtitle)
      }
    })
    return () => unsub()
  }, [])

  // Update available dates when visibleDays or closedDate changes
  useEffect(() => {
    let dates = getNextBusinessDays(visibleDays)
    const todayId = formatDateId(new Date())
    
    // Si hoy está cerrado, filtrar el primer elemento si es hoy
    if (closedDate === todayId) {
      dates = dates.filter(d => formatDateId(d) !== todayId)
    }
    
    setAvailableDates(dates)
    
    // Si la fecha seleccionada ya no está disponible, cambiar a la primera disponible
    if (dates.length > 0) {
      const isStillAvailable = dates.some(d => formatDateId(d) === deliveryDate)
      if (!isStillAvailable) {
        setDeliveryDate(formatDateId(dates[0]))
      }
    }
  }, [visibleDays, closedDate])

  // Real-time daily inventory for selected date
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'daily_inventory', deliveryDate), (d) => {
      const isToday = deliveryDate === formatDateId(new Date())
      if (d.exists()) {
        const data = d.data()
        setDailyInventory(data.stocks || {})
        setIsUnlimitedDay(!!data.isUnlimited)
        setUnlimitedItems(data.unlimitedItems || [])
      } else {
        setDailyInventory({})
        setUnlimitedItems([])
        // Si no existe el registro, los días futuros son ilimitados por defecto
        setIsUnlimitedDay(!isToday)
      }
    })
    return () => unsub()
  }, [deliveryDate])

  // Limpiar carrito al cambiar tipo de pedido
  // Limpiar carrito al cambiar fecha de entrega
  const handleDateChange = (dateId: string) => {
    if (cart.length > 0 && !window.confirm('Cambiar la fecha de entrega vaciará tu carrito actual. ¿Continuar?')) {
      return
    }
    setDeliveryDate(dateId)
    setCart([])
  }

  
  const PRODUCTS: Product[] = inventory
    .filter(i => i.type === 'product' && !i.disabled)
    .sort((a, b) => {
      const priority: Record<string, number> = { 'product_muffin_base': 1, 'product_empanadas_gourmet': 2, 'product_mini_pays': 3, 'product_mojaditos': 4 }
      const prioA = priority[a.id] || 99
      const prioB = priority[b.id] || 99
      return prioA - prioB
    })
    .map((i: any) => {
      // Compatibilidad con productos viejos que no tienen optionGroups configurados
      let groups = i.optionGroups
      if (!groups) {
        if (i.id === 'product_muffin_base') groups = [{ label: 'Elige tu sabor', category: 'muffin' }]
        else if (i.id === 'product_empanadas_gourmet') groups = [{ label: 'Elige tu sabor', category: 'empanada' }]
      }
      
      return {
        id: i.id,
        name: i.name,
        icon: i.icon,
        price: i.price,
        description: i.description || '',
        optionGroups: groups
      }
    })
  
  const getStock = (inventoryId: string) => {
    return dailyInventory[inventoryId] || 0
  }

  // Customer Details
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  
  // Checkout State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderId, setOrderId] = useState('')

  const handleAddToCart = (product: Product) => {
    const productOptions = selectedOptions[product.id] || {}
    const requiredGroups = product.optionGroups || []
    
    // Verificar que todas las opciones requeridas estén seleccionadas
    for (const group of requiredGroups) {
      if (!productOptions[group.category]) {
        toast.error(`Por favor selecciona: ${group.label}`)
        return
      }
    }

    const selectedOptionsData: SelectedOption[] = requiredGroups.map(group => {
      const optionId = productOptions[group.category]
      const option = inventory.find(i => i.id === optionId)
      return {
        id: optionId,
        name: option?.name || 'Sabor',
        icon: option?.icon || '✨',
        category: group.category
      }
    })

    // Validar stock para cada opción y para el producto mismo
    const itemsToCheck = [
      ...(requiredGroups.length > 0 ? selectedOptionsData.map(o => o.id) : [product.id])
    ]

    if (!isUnlimitedDay) {
      for (const invId of itemsToCheck) {
        if (getStock(invId) <= 0 && !unlimitedItems.includes(invId)) {
          const item = inventory.find(i => i.id === invId) || product
          toast.error(`Lo sentimos, ${item.name} se ha agotado.`)
          return
        }
      }
    }

    const optionsKey = selectedOptionsData.map(o => o.id).sort().join('-')
    const cartItemId = optionsKey ? `${product.id}-${optionsKey}` : product.id

    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId)
      if (existing) {
        // Validar stock acumulado
        if (!isUnlimitedDay) {
          for (const invId of itemsToCheck) {
            if (!unlimitedItems.includes(invId) && existing.quantity + 1 > getStock(invId)) {
              const item = inventory.find(i => i.id === invId) || product
              toast.error(`Solo quedan ${getStock(invId)} de ${item.name} disponibles.`)
              return prev
            }
          }
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
        name: product.name,
        icon: product.icon,
        price: product.price,
        quantity: 1,
        options: selectedOptionsData
      }

      toast.success(`Agregado: ${product.name}`)
      return [...prev, newItem]
    })

    // Limpiar selecciones para este producto
    setSelectedOptions(prev => {
      const updated = { ...prev }
      delete updated[product.id]
      return updated
    })
  }

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = item.quantity + delta
        if (newQty <= 0) return item

        const itemsToCheck = item.options.length > 0 ? item.options.map(o => o.id) : [item.productId]
        
        if (!isUnlimitedDay && delta > 0) {
          for (const invId of itemsToCheck) {
            const available = getStock(invId)
            if (!unlimitedItems.includes(invId) && newQty > available) {
              const invItem = inventory.find(i => i.id === invId) || item
              toast.error(`Solo quedan ${available} de ${invItem.name} disponibles.`)
              return item
            }
          }
        }
        
        return { ...item, quantity: newQty }
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
      // Usar transacción para verificar stock y decrementar en daily_inventory
      await runTransaction(db, async (transaction) => {
        const dailyInventoryRef = doc(db, 'daily_inventory', deliveryDate)
        const dailyInventorySnap = await transaction.get(dailyInventoryRef)
        const isToday = deliveryDate === formatDateId(new Date())
        
        let isUnlimited = !isToday // Por defecto ilimitado si no es hoy
        let currentStocks: Record<string, number> = {}
        let unlimitedItemsList: string[] = []

        if (dailyInventorySnap.exists()) {
          const data = dailyInventorySnap.data()
          currentStocks = data.stocks || {}
          isUnlimited = !!data.isUnlimited
          unlimitedItemsList = data.unlimitedItems || []
        } else if (isToday) {
          // Si es hoy y no hay registro, asumimos que no hay stock (o ya pasó la hora)
          throw new Error('Lo sentimos, no hay inventario configurado para hoy.')
        }

        const newStocks = { ...currentStocks }

        // Verificación de stock
        for (const item of cart) {
          const itemsToCheck = item.options.length > 0 ? item.options.map(o => o.id) : [item.productId]
          
          for (const invId of itemsToCheck) {
            const available = newStocks[invId] ?? (currentStocks[invId] || 0)
            const itemIsUnlimited = isUnlimited || unlimitedItemsList.includes(invId)
            
            if (!itemIsUnlimited && available < item.quantity) {
              const invItem = inventory.find(i => i.id === invId)
              throw new Error(`¡Ups! Stock insuficiente para "${invItem?.name || item.name}". Solo quedan ${available}.`)
            }
            if (!itemIsUnlimited) {
              newStocks[invId] = available - item.quantity
            }
          }
        }

        // Decrementar stock
        transaction.set(dailyInventoryRef, { stocks: newStocks }, { merge: true })

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
          deliveryDate,
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
        <img src="/logo.png" alt={storeName} className="logo" />
        <h1>{storeName}</h1>
        <p>{storeSubtitle}</p>
      </header>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', padding: '0.5rem', background: 'var(--surface)', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {availableDates.map(date => {
          const id = formatDateId(date)
          const isSelected = deliveryDate === id
          return (
            <button 
              key={id}
              onClick={() => handleDateChange(id)}
              style={{ 
                flex: '0 0 auto', padding: '0.8rem 1.2rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: isSelected ? 'var(--primary)' : 'transparent',
                color: isSelected ? 'white' : 'var(--text)',
                fontWeight: 600, transition: 'all 0.2s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                minWidth: '85px'
              }}
            >
              {formatDisplayDate(date)}
            </button>
          )
        })}
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
              {product.optionGroups && product.optionGroups.map((group, idx) => (
                <select 
                  key={`${product.id}-${group.category}-${idx}`}
                  className="flavor-select"
                  value={selectedOptions[product.id]?.[group.category] || ''}
                  onChange={(e) => {
                    setSelectedOptions(prev => ({
                      ...prev,
                      [product.id]: {
                        ...(prev[product.id] || {}),
                        [group.category]: e.target.value
                      }
                    }))
                  }}
                  style={{ marginBottom: '0.5rem' }}
                >
                  <option value="" disabled>{group.label}...</option>
                  {inventory
                    .filter(i => i.type === 'flavor' && i.category === group.category && !i.disabled)
                    .map(option => {
                      const stock = getStock(option.id)
                      const itemIsUnlimited = isUnlimitedDay || unlimitedItems.includes(option.id)
                      return (
                        <option key={option.id} value={option.id} disabled={!itemIsUnlimited && stock <= 0}>
                          {option.icon} {option.name} {!itemIsUnlimited ? (stock <= 0 ? '(AGOTADO)' : `(${stock} disp.)`) : ''}
                        </option>
                      )
                    })}
                </select>
              ))}
              
              {(() => {
                const requiredGroups = product.optionGroups || []
                
                // Si no tiene opciones, checamos stock del producto base
                const isOutOfStock = !isUnlimitedDay && !unlimitedItems.includes(product.id) && getStock(product.id) <= 0 && requiredGroups.length === 0
                
                return (
                  <>
                    {isOutOfStock && (
                      <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertCircle size={14} /> Producto agotado hoy
                      </div>
                    )}
                    
                    <button 
                      className="add-btn" 
                      onClick={() => handleAddToCart(product)}
                      disabled={isOutOfStock}
                      style={{ opacity: isOutOfStock ? 0.6 : 1 }}
                    >
                      {isOutOfStock ? 'No disponible' : 'Agregar al carrito'}
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
                    {item.options && item.options.length > 0 && (
                      <div className="cart-item-flavor">
                        {item.options.map(opt => (
                          <div key={opt.category}>{opt.name} {opt.icon}</div>
                        ))}
                      </div>
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
