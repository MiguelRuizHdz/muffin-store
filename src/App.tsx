import { useState } from 'react'

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

// Escaping emojis using String.fromCodePoint to guarantee correct execution at runtime
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

function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedFlavor, setSelectedFlavor] = useState<string>('')

  const handleAddToCart = (product: Product) => {
    if (product.requiresFlavor && !selectedFlavor) {
      alert('Por favor selecciona un sabor para tu muffin.')
      return
    }

    const flavor = MUFFIN_FLAVORS.find(f => f.id === selectedFlavor)
    
    // Create a unique ID combining product and flavor so we group identical items
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

      return [
        ...prev,
        {
          id: cartItemId,
          productId: product.id,
          name: product.name,
          icon: product.icon,
          flavorName: flavor?.name,
          flavorIcon: flavor?.icon,
          price: product.price,
          quantity: 1
        }
      ]
    })

    // Reset flavor selection after adding
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

  const handleCheckout = () => {
    if (cart.length === 0) return

    let text = `*\u00A1Hola! Quiero hacer un pedido:*\n\n`
    
    cart.forEach(item => {
      text += `\u2022 ${item.quantity}x ${item.name}`
      if (item.flavorName) {
        text += ` (Sabor: ${item.flavorName})`
      }
      text += ` - $${item.price * item.quantity}\n`
    })

    text += `\n*Total a pagar: $${total} MXN*\n\n`
    text += `\u00A1Quedo a la espera de confirmaci\u00F3n!`

    // Encode the URI and use whatsapp link
    const encodedText = encodeURIComponent(text)
    window.open(`https://api.whatsapp.com/send?text=${encodedText}`, '_blank')
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
          <>
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
                      <button className="qty-btn" onClick={() => updateQuantity(item.id, -1)}>−</button>
                      <span>{item.quantity}</span>
                      <button className="qty-btn" onClick={() => updateQuantity(item.id, 1)}>+</button>
                    </div>
                    <button className="remove-btn" onClick={() => removeItem(item.id)}>{String.fromCodePoint(0x1F5D1, 0xFE0F)}</button>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="cart-summary">
              <div className="total-row">
                <span>Total:</span>
                <span style={{ color: 'var(--primary)' }}>${total}</span>
              </div>
              
              <button className="checkout-btn" onClick={handleCheckout}>
                <span>{String.fromCodePoint(0x1F4F1)}</span> Pedir por WhatsApp
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
