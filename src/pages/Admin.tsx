import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, orderBy, doc, getDocs, updateDoc, setDoc, deleteDoc, addDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import toast from 'react-hot-toast'
import { Loader2, Settings, LogOut, CheckCircle, Clock, Package, DollarSign, Edit3, Camera, X, Trash2, Activity, BarChart2, List, MessageCircle, Plus, Minus, Info, Calendar, AlertCircle, RotateCcw } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { getNextBusinessDays, formatDateId, formatDisplayDate } from '../utils/dates'

interface OrderItem {
  id: string
  name: string
  icon: string
  flavorName?: string
  flavorIcon?: string
  price: number
  quantity: number
}

interface Order {
  id: string
  shortId?: string
  customerName: string
  customerPhone: string
  items: OrderItem[]
  total: number
  status: 'nuevo' | 'cocinando' | 'empaque' | 'entregado'
  isPaid: boolean
  orderType?: 'today' | 'tomorrow'
  deliveryDate?: string
  createdAt: any
}

export default function Admin() {
  const [isAuthChecking, setIsAuthChecking] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [role, setRole] = useState<'admin' | 'cocina' | null>(null)
  
  const [passwordInput, setPasswordInput] = useState('')
  const [dbAdminPassword, setDbAdminPassword] = useState('')
  const [dbCocinaPassword, setDbCocinaPassword] = useState('')

  const [orders, setOrders] = useState<Order[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [inventory, setInventory] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'orders' | 'inventory'>('orders')
  
  const [showSettings, setShowSettings] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newCocinaPassword, setNewCocinaPassword] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isScanning, setIsScanning] = useState(false)

  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null)
  const [editStockValue, setEditStockValue] = useState<string>('')
  const [editPriceValue, setEditPriceValue] = useState<string>('')

  const [visibleDays, setVisibleDays] = useState(5)
  const [availableDates, setAvailableDates] = useState<Date[]>(() => getNextBusinessDays(5))
  const [selectedInventoryDate, setSelectedInventoryDate] = useState(formatDateId(new Date()))
  const [unlimitedItems, setUnlimitedItems] = useState<string[]>([])
  const [dailyInventory, setDailyInventory] = useState<Record<string, number>>({})
  const [isUnlimitedDay, setIsUnlimitedDay] = useState(false)
  
  const [showNewItemForm, setShowNewItemForm] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemType, setNewItemType] = useState<'flavor' | 'product'>('product')
  const [newItemPrice, setNewItemPrice] = useState('15')
  const [newItemIcon, setNewItemIcon] = useState('🥜')
  const [newItemDescription, setNewItemDescription] = useState('')

  // 1. Fetch password settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsSnap = await getDocs(collection(db, 'settings'))
        
        let adminPass = 'admin'
        let cocinaPass = 'cocina'
        let adminFound = false
        let cocinaFound = false

        settingsSnap.forEach((d) => {
          if (d.id === 'admin') { 
            adminPass = d.data().password; 
            adminFound = true;
            if (d.data().visibleDays) setVisibleDays(d.data().visibleDays);
          }
          if (d.id === 'cocina') { cocinaPass = d.data().password; cocinaFound = true }
        })
        
        if (!adminFound) await setDoc(doc(db, 'settings', 'admin'), { password: adminPass, visibleDays: 5 })
        if (!cocinaFound) await setDoc(doc(db, 'settings', 'cocina'), { password: cocinaPass })

        setDbAdminPassword(adminPass)
        setDbCocinaPassword(cocinaPass)

        // Check session
        const storedRole = sessionStorage.getItem('userRole')
        if (storedRole === 'admin' || storedRole === 'cocina') {
          setIsLoggedIn(true)
          setRole(storedRole as 'admin' | 'cocina')
        }
      } catch (error) {
        console.error("Error fetching settings:", error)
        toast.error("Error de conexión con la base de datos.")
      } finally {
        setIsAuthChecking(false)
      }
    }
    fetchSettings()
  }, [])

  // 1.5 Update available dates when visibleDays changes
  useEffect(() => {
    setAvailableDates(getNextBusinessDays(visibleDays))
  }, [visibleDays])

  // 2. Fetch orders in real time (only if logged in)
  useEffect(() => {
    if (!isLoggedIn) return

    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[]
      setOrders(ordersData)
    }, (error) => {
      console.error("Error listening to orders:", error)
      toast.error("Error al cargar pedidos.")
    })

    return () => unsubscribe()
  }, [isLoggedIn])

  // 2.5 Fetch inventory in real time
  useEffect(() => {
    if (!isLoggedIn) return
    const q = query(collection(db, 'inventory'))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setInventory(invData)
    })
    return () => unsubscribe()
  }, [isLoggedIn])

  // 2.5.1 Auto-sync base products if missing
  useEffect(() => {
    if (isLoggedIn && role === 'admin' && inventory.length > 0) {
      const hasCacahuates = inventory.some(i => i.id === 'product_cacahuates')
      const hasDescriptions = inventory.some(i => i.type === 'product' && i.description)
      if (!hasCacahuates || !hasDescriptions) {
        initializeInventory(true)
      }
    }
  }, [isLoggedIn, role, inventory.length])

  // 2.6 Fetch daily inventory
  useEffect(() => {
    if (!isLoggedIn) return
    const unsub = onSnapshot(doc(db, 'daily_inventory', selectedInventoryDate), (d) => {
      if (d.exists()) {
        const data = d.data()
        const currentStocks: Record<string, number> = data.stocks || {}
        setDailyInventory(currentStocks)
        setIsUnlimitedDay(!!data.isUnlimited)
        setUnlimitedItems(data.unlimitedItems || [])
      } else {
        setDailyInventory({})
        setIsUnlimitedDay(false)
        setUnlimitedItems([])
      }
    })
    return () => unsub()
  }, [isLoggedIn, selectedInventoryDate])

  // 3. Fetch logs
  useEffect(() => {
    if (!isLoggedIn || role !== 'admin' || !showActivity) return
    const q = query(collection(db, 'order_logs'), orderBy('timestamp', 'desc'))
    const unsub = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [isLoggedIn, role, showActivity])

  const logEvent = async (desc: string) => {
    try {
      await addDoc(collection(db, 'order_logs'), {
        action: desc,
        role: role,
        timestamp: new Date()
      })
    } catch(e) { console.error("Error logging event:", e) }
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (passwordInput === dbAdminPassword) {
      setIsLoggedIn(true); setRole('admin')
      sessionStorage.setItem('userRole', 'admin')
      toast.success('Sesión de Admin iniciada')
    } else if (passwordInput === dbCocinaPassword) {
      setIsLoggedIn(true); setRole('cocina')
      sessionStorage.setItem('userRole', 'cocina')
      toast.success('Sesión de Cocina iniciada')
    } else {
      toast.error('Contraseña incorrecta')
    }
  }

  const handleLogout = () => {
    setIsLoggedIn(false); setRole(null)
    sessionStorage.removeItem('userRole')
    setPasswordInput('')
  }

  const handleUpdatePassword = async (e: React.FormEvent, type: 'admin'|'cocina') => {
    e.preventDefault()
    const pw = type === 'admin' ? newPassword : newCocinaPassword
    if (!pw || pw.length < 4) {
      toast.error('La contraseña debe tener al menos 4 caracteres')
      return
    }

    try {
      await updateDoc(doc(db, 'settings', type), { password: pw })
      if (type === 'admin') { setDbAdminPassword(pw); setNewPassword('') }
      else { setDbCocinaPassword(pw); setNewCocinaPassword('') }
      toast.success('Contraseña actualizada')
    } catch (error) {
      toast.error('Error al actualizar contraseña')
    }
  }

  const handleUpdateVisibleDays = async (val: number) => {
    try {
      await updateDoc(doc(db, 'settings', 'admin'), { visibleDays: val })
      setVisibleDays(val)
      toast.success('Configuración guardada')
    } catch (error) {
      toast.error('Error al guardar configuración')
    }
  }
  const updateOrderStatus = async (orderId: string, shortId: string | undefined, currentStatus: Order['status']) => {
    try {
      let nextStatus: Order['status'] = 'cocinando'
      if (currentStatus === 'cocinando') nextStatus = 'empaque'
      if (currentStatus === 'empaque') {
        if (role === 'cocina') return // Cocina cannot deliver
        nextStatus = 'entregado'
      }
      if (currentStatus === 'entregado') return

      await updateDoc(doc(db, 'orders', orderId), { status: nextStatus })
      toast.success('Estado actualizado')
      logEvent(`Pedido #${shortId || orderId} movido a "${nextStatus.toUpperCase()}"`)
    } catch (error) {
      toast.error('Error al actualizar código')
    }
  }

  const resetOrderStatus = async (orderId: string, shortId: string | undefined) => {
    if (!window.confirm(`¿Seguro que deseas reiniciar el pedido #${shortId || orderId}? Volverá al estado "NUEVO".`)) return
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'nuevo' })
      toast.success('Pedido reiniciado')
      logEvent(`Pedido #${shortId || orderId} fue REINICIADO a "NUEVO"`)
    } catch (error) {
      toast.error('Error al reiniciar pedido')
    }
  }

  const deleteOrder = async (orderId: string, shortId: string | undefined) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este pedido por completo? Esta acción no se puede deshacer.')) {
      try {
        await deleteDoc(doc(db, 'orders', orderId))
        toast.success('Pedido eliminado')
        logEvent(`Pedido #${shortId || orderId} fue ELIMINADO del sistema`)
      } catch (error) {
        toast.error('Error al eliminar pedido')
      }
    }
  }

  const togglePaymentStatus = async (orderId: string, currentPaid: boolean) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { isPaid: !currentPaid })
      toast.success(currentPaid ? 'Marcado como No Pagado' : 'Marcado como Pagado')
    } catch (error) {
      toast.error('Error al actualizar pago')
    }
  }

  const updateInventoryValue = async (id: string, field: 'stock' | 'price', value: number) => {
    try {
      if (field === 'stock') {
        const newDaily = { ...dailyInventory, [id]: value }
        await setDoc(doc(db, 'daily_inventory', selectedInventoryDate), { stocks: newDaily }, { merge: true })
      } else {
        await updateDoc(doc(db, 'inventory', id), { [field]: value })
      }
      toast.success('Inventario actualizado')
      setEditingInventoryId(null)
    } catch (e) {
      toast.error('Error al actualizar')
    }
  }

  const adjustStock = async (id: string, current: number, delta: number) => {
    const newVal = Math.max(0, current + delta)
    try {
      const newDaily = { ...dailyInventory, [id]: newVal }
      await setDoc(doc(db, 'daily_inventory', selectedInventoryDate), { stocks: newDaily }, { merge: true })
    } catch (e) {
      toast.error('Error al ajustar stock')
    }
  }

  const initializeInventory = async (silent = false) => {
    let toastId: string | undefined
    if (!silent) toastId = toast.loading('Sincronizando productos base...')
    try {
      const batch = writeBatch(db)
      
      const items = [
        { id: 'flavor_nuez', name: 'Nuez', type: 'flavor', icon: '🥜', stock: 0 },
        { id: 'flavor_almendra', name: 'Almendra', type: 'flavor', icon: '🌰', stock: 0 },
        { id: 'flavor_arandano', name: 'Arándano', type: 'flavor', icon: '🫐', stock: 0 },
        { id: 'flavor_chispas', name: 'Chispas de chocolate', type: 'flavor', icon: '🍫', stock: 0 },
        { id: 'flavor_nutella', name: 'Nutella', type: 'flavor', icon: '🍫✨', stock: 0 },
        { id: 'flavor_goober', name: 'Goober (fresa con cacahuate)', type: 'flavor', icon: '🍓🥜', stock: 0 },
        { id: 'product_muffin_base', name: 'Muffins de plátano', type: 'product', icon: '🍌', stock: 0, price: 15, description: 'Precio base del muffin' },
        { id: 'product_mini_pays', name: 'Mini pays de queso', type: 'product', icon: '🧀', stock: 0, price: 15, description: '2 por $15 (1 bolsa incluye 2 pays)' },
        { id: 'product_cacahuates', name: 'Bolsa de cacahuates japoneses', type: 'product', icon: '🥜', stock: 0, price: 15, description: 'Contiene bolsa de salsa botanera' }
      ]

      items.forEach(item => {
        const ref = doc(db, 'inventory', item.id)
        batch.set(ref, item, { merge: true })
      })

      await batch.commit()
      if (!silent) toast.success('Productos base cargados correctamente', { id: toastId })
    } catch (error) {
      if (!silent) toast.error('Error al sincronizar productos', { id: toastId })
    }
  }

  const toggleDailyUnlimited = async () => {
    try {
      await setDoc(doc(db, 'daily_inventory', selectedInventoryDate), { isUnlimited: !isUnlimitedDay }, { merge: true })
      toast.success(`Modo ${!isUnlimitedDay ? 'Ilimitado' : 'Limitado'} activado`)
    } catch (e) {
      toast.error('Error al actualizar')
    }
  }

  const toggleItemUnlimited = async (itemId: string) => {
    try {
      const isCurrentlyUnlimited = unlimitedItems.includes(itemId)
      const newUnlimited = isCurrentlyUnlimited 
        ? unlimitedItems.filter(id => id !== itemId)
        : [...unlimitedItems, itemId]
      
      await setDoc(doc(db, 'daily_inventory', selectedInventoryDate), { unlimitedItems: newUnlimited }, { merge: true })
      toast.success(isCurrentlyUnlimited ? 'Stock ahora es manual' : 'Producto marcado como ilimitado')
    } catch (e) {
      toast.error('Error al cambiar modo de stock')
    }
  }

  const addNewItem = async () => {
    if (!newItemName) return toast.error('Nombre requerido')
    // Generate clean ID from name
    const id = newItemName.toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, '')
    
    try {
      const fullId = `${newItemType === 'flavor' ? 'flavor_' : 'product_'}${id}`
      const item = {
        id: fullId,
        name: newItemName,
        type: newItemType,
        icon: newItemIcon || (newItemType === 'flavor' ? '🍩' : '📦'),
        price: newItemType === 'product' ? parseInt(newItemPrice) : 0,
        description: newItemDescription,
        stock: 0
      }
      await setDoc(doc(db, 'inventory', fullId), item)
      toast.success('Producto agregado con éxito')
      setShowNewItemForm(false)
      setNewItemName('')
      setNewItemDescription('')
    } catch (e) {
      toast.error('Error al agregar')
    }
  }

  if (isAuthChecking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg)' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-dark)' }}>
        <form onSubmit={handleLogin} style={{ background: 'var(--bg-card)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--text)' }}>Acceso Admin</h2>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="password"
              placeholder="Contraseña"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd' }}
              autoFocus
            />
          </div>
          <button type="submit" className="checkout-btn" style={{ width: '100%' }}>Ingresar</button>
        </form>
      </div>
    )
  }

  const getStatusBadge = (status: Order['status']) => {
    const config = {
      'nuevo': { bg: '#ffe4e6', color: '#e11d48', icon: <Package size={14} />, text: 'Nuevo' },
      'cocinando': { bg: '#fef3c7', color: '#d97706', icon: <Clock size={14} />, text: 'Cocinando' },
      'empaque': { bg: '#dbeafe', color: '#1d4ed8', icon: <Package size={14} />, text: 'Empaque' },
      'entregado': { bg: '#dcfce7', color: '#15803d', icon: <CheckCircle size={14} />, text: 'Entregado' }
    }
    const curr = config[status]
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: curr.bg, color: curr.color }}>
        {curr.icon} {curr.text}
      </span>
    )
  }

  const filteredOrders = orders.filter(order => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = (order.shortId && order.shortId.toLowerCase().includes(term)) ||
           order.customerName.toLowerCase().includes(term);
    
    if (role === 'cocina' && order.status === 'entregado') return false;
    
    return matchesSearch;
  });

  return (
    <div style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-dark)', minHeight: '100vh' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--primary)' }}>Gestión de Pedidos</h1>
        
        <div style={{ flex: '1 1 300px', maxWidth: '500px', display: 'flex', gap: '0.5rem' }}>
          <input 
            type="text" 
            placeholder="Buscar por código (#A4F2) o nombre..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.6rem 1rem', borderRadius: '99px', border: '1px solid #ddd', fontSize: '0.95rem' }}
          />
          <button 
            type="button" 
            onClick={() => setIsScanning(true)} 
            style={{ padding: '0.6rem', borderRadius: '50%', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', flexShrink: 0 }}
            title="Escanear QR con cámara"
          >
            <Camera size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            type="button" 
            onClick={() => setActiveTab(activeTab === 'orders' ? 'inventory' : 'orders')} 
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
          >
            {activeTab === 'orders' ? <List size={18} /> : <Package size={18} />}
            {activeTab === 'orders' ? 'Inventario' : 'Pedidos'}
          </button>

          {role === 'admin' && (
            <>
              <button type="button" onClick={() => { setShowStats(!showStats); setShowActivity(false); setShowSettings(false) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }} title="Estadísticas Diarias">
                <BarChart2 size={20} />
              </button>
              <button type="button" onClick={() => { setShowActivity(!showActivity); setShowSettings(false); setShowStats(false) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }} title="Historial">
                <Activity size={20} />
              </button>
              <button type="button" onClick={() => { setShowSettings(!showSettings); setShowActivity(false); setShowStats(false) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }} title="Ajustes">
                <Settings size={20} />
              </button>
            </>
          )}
          <button type="button" onClick={handleLogout} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }} title="Cerrar sesión">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {showSettings && role === 'admin' && (
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Edit3 size={18}/> Contraseña ADMIN</h3>
            <form onSubmit={e => handleUpdatePassword(e, 'admin')} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <input type="text" placeholder="Nueva contraseña admin" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ddd' }} />
              <button type="submit" className="add-btn" style={{ padding: '0.6rem 1rem' }}>Guardar</button>
            </form>
          </div>
          <div style={{ padding: '1.5rem', background: 'var(--bg-dark)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calendar size={18}/> Días Visibles en Tienda</h3>
              <p style={{ margin: '5px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Cuantos días hábiles (Lunes a Viernes) pueden ver los clientes.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <input 
                type="number" 
                min="1" 
                max="15" 
                value={visibleDays} 
                onChange={e => handleUpdateVisibleDays(parseInt(e.target.value) || 5)} 
                style={{ width: '60px', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'white', textAlign: 'center' }} 
              />
              <span style={{ fontSize: '0.9rem' }}>días</span>
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Edit3 size={18}/> Contraseña COCINA</h3>
            <form onSubmit={e => handleUpdatePassword(e, 'cocina')} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <input type="text" placeholder="Nueva contraseña cocina" value={newCocinaPassword} onChange={e => setNewCocinaPassword(e.target.value)} style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ddd' }} />
              <button type="submit" className="add-btn" style={{ padding: '0.6rem 1rem' }}>Guardar</button>
            </form>
          </div>
        </div>
      )}

      {showActivity && role === 'admin' && (
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>Historial de Actividad</h3>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {logs.map(log => (
              <div key={log.id} style={{ fontSize: '0.85rem', padding: '0.5rem 0', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
                <span><strong>[{log.role?.toUpperCase() || 'SISTEMA'}]</strong> {log.action}</span>
                <span style={{ color: '#888' }}>{log.timestamp instanceof Date ? log.timestamp.toLocaleString() : (log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : '')}</span>
              </div>
            ))}
            {logs.length === 0 && <span style={{ color: '#888' }}>No hay registros.</span>}
          </div>
        </div>
      )}

      {showStats && role === 'admin' && (
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><BarChart2 size={18}/> Estadísticas Diarias</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {Object.values(
              orders.reduce((acc: any, order) => {
                 const dateObj = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
                 const dateKey = dateObj.toLocaleDateString();
                 if (!acc[dateKey]) acc[dateKey] = { date: dateKey, totalEarnings: 0, itemsCooked: 0 };
                 
                 // Solo sumar ganancias si la orden ya fue cobrada
                 if (order.isPaid) acc[dateKey].totalEarnings += order.total;
                 
                 // Sumar todos los items (muffins y pays) procesados en el día
                 order.items.forEach(item => {
                   acc[dateKey].itemsCooked += item.quantity;
                 });
                 return acc;
              }, {})
            ).map((stat: any) => (
              <div key={stat.date} style={{ padding: '1rem', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>{stat.date}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Ventas (Pagadas): <strong style={{ color: 'var(--primary)', fontSize: '1rem' }}>${stat.totalEarnings}</strong></div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Productos hechos: <strong style={{ color: 'var(--text-main)' }}>{stat.itemsCooked}</strong></div>
              </div>
            ))}
          </div>
          {orders.length === 0 && <span style={{ color: '#888' }}>No hay información para generar estadísticas.</span>}
        </div>
      )}

      {isScanning && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ padding: '1.5rem', background: 'var(--bg-card)', borderRadius: '12px', width: '90%', maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
               <h3 style={{ margin: 0 }}>Escanear QR del Pedido</h3>
               <button onClick={() => setIsScanning(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}><X /></button>
            </div>
            <div style={{ borderRadius: '8px', overflow: 'hidden' }}>
              <Scanner 
                  onScan={(detectedCodes) => {
                      if (detectedCodes && Array.isArray(detectedCodes) && detectedCodes.length > 0) {
                          setSearchTerm(detectedCodes[0].rawValue);
                          setIsScanning(false);
                      } else if (typeof detectedCodes === 'string') {
                          setSearchTerm(detectedCodes);
                          setIsScanning(false);
                      }
                  }} 
                  onError={(error: any) => console.log("Camera error:", error?.message)}
              />
            </div>
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#666', marginTop: '1rem' }}>
              Permite el uso de cámara cuando el navegador te lo pida.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'inventory' ? (
        <>
          <div style={{ paddingBottom: '2rem' }}>
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '1.5rem', 
              background: 'var(--bg-card)', 
              padding: '1.5rem', 
              borderRadius: '12px', 
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              marginBottom: '1.5rem'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                flexWrap: 'wrap', 
                gap: '1rem' 
              }}>
                <div>
                  <h2 style={{ margin: 0 }}>Gestión de Inventario</h2>
                  <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Controla los niveles de stock y disponibilidad diaria.</p>
                </div>
                
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => setShowNewItemForm(!showNewItemForm)} 
                    className="add-btn" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1rem' }}
                  >
                    <Plus size={16} /> Nuevo
                  </button>
                  <button onClick={() => initializeInventory()} className="add-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#4A5568', padding: '0.6rem 1rem' }}>
                    <Package size={16} /> Cargar Base
                  </button>
                </div>
              </div>

              <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                flexWrap: 'wrap',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '1.5rem'
              }}>
                  <div style={{ 
                    display: 'flex', 
                    background: 'var(--bg-dark)', 
                    padding: '0.25rem', 
                    borderRadius: '10px', 
                    gap: '0.25rem',
                    overflowX: 'auto',
                    maxWidth: '100%',
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch'
                  }}>
                    {availableDates.map(date => {
                      const id = formatDateId(date)
                      const isSelected = selectedInventoryDate === id
                      return (
                        <button
                          key={id}
                          onClick={() => setSelectedInventoryDate(id)}
                          style={{
                            padding: '0.5rem 0.8rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: isSelected ? 'var(--primary)' : 'transparent',
                            color: isSelected ? 'black' : 'var(--text-muted)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            minWidth: 'fit-content'
                          }}
                        >
                          {formatDisplayDate(date)}
                        </button>
                      )
                    })}
                  </div>
                  
                  <button 
                    onClick={toggleDailyUnlimited} 
                    className={`limit-toggle ${isUnlimitedDay ? 'active' : 'inactive'}`}
                    style={{ 
                      background: isUnlimitedDay ? 'rgba(37, 211, 102, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: isUnlimitedDay ? '#25D366' : '#ef4444',
                      borderColor: isUnlimitedDay ? 'rgba(37, 211, 102, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                      padding: '0.6rem 1rem',
                      borderRadius: '8px',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      transition: 'all 0.2s',
                      flexShrink: 0
                    }}
                  >
                    {isUnlimitedDay ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {isUnlimitedDay ? 'Todo Ilimitado' : 'Stock Manual'}
                  </button>
              </div>
            </div>

            {showNewItemForm && (
              <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', border: '1px solid var(--primary)' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.4rem' }}>NOMBRE</label>
                  <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Ej: Bolsa de cacahuates" style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-dark)', color: 'white' }} />
                </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.4rem' }}>TIPO</label>
                <select value={newItemType} onChange={e => setNewItemType(e.target.value as any)} style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-dark)', color: 'white' }}>
                  <option value="product">Producto (Pay/Botana)</option>
                  <option value="flavor">Sabor de Muffin</option>
                </select>
              </div>
              <div style={{ width: '60px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.4rem' }}>ICONO</label>
                <input type="text" value={newItemIcon} onChange={e => setNewItemIcon(e.target.value)} placeholder="🥜" style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-dark)', color: 'white', textAlign: 'center' }} />
              </div>
              {newItemType === 'product' && (
                <div style={{ width: '80px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.4rem' }}>PRECIO</label>
                  <input type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-dark)', color: 'white' }} />
                </div>
              )}
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.4rem' }}>DESCRIPCIÓN (Opcional)</label>
                <input type="text" value={newItemDescription} onChange={e => setNewItemDescription(e.target.value)} placeholder="Ej: Contiene salsa" style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-dark)', color: 'white' }} />
              </div>
              <button onClick={addNewItem} className="add-btn" style={{ height: '42px', padding: '0 1.5rem' }}>Agregar</button>
            </div>
          )}

          {[
            { title: 'Sabores de Muffin', items: inventory.filter(i => i.type === 'flavor'), icon: <Info size={18} /> },
            { title: 'Productos Directos', items: inventory.filter(i => i.type === 'product'), icon: <Package size={18} /> }
          ].map((section) => section.items.length > 0 && (
            <div key={section.title}>
              <h3 className="inventory-section-title">{section.icon} {section.title}</h3>
              <div className="inventory-grid">
                {section.items.map((item) => (
                  <div key={item.id} className="inventory-card">
                    <div className="inventory-card-header">
                      <div className="inventory-card-info">
                        <div className="inventory-icon">{item.icon}</div>
                        <div>
                          <h4 className="inventory-name">{item.name}</h4>
                          <span className="inventory-type">{item.type === 'flavor' ? 'Sabor' : 'Producto'}</span>
                        </div>
                      </div>
                      {role === 'admin' && (
                        <button 
                          onClick={() => {
                            if (editingInventoryId === item.id) {
                              setEditingInventoryId(null)
                            } else {
                              setEditingInventoryId(item.id)
                              setEditStockValue(item.stock.toString())
                              setEditPriceValue((item.price || 0).toString())
                            }
                          }}
                          className="adjust-btn"
                          title="Editar detalles"
                        >
                          <Edit3 size={16} />
                        </button>
                      )}
                    </div>

                    <div className="stock-control">
                      <div style={{ flex: 1 }}>
                        <div className="stock-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>STOCK {formatDisplayDate(new Date(selectedInventoryDate + 'T12:00:00'))}</span>
                          <button 
                            onClick={() => toggleItemUnlimited(item.id)}
                            style={{ 
                              background: unlimitedItems.includes(item.id) ? 'var(--primary)' : 'transparent',
                              border: '1px solid var(--border-color)',
                              color: unlimitedItems.includes(item.id) ? 'white' : 'var(--text-muted)',
                              fontSize: '0.65rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            {unlimitedItems.includes(item.id) ? 'ILIMITADO' : 'MANUAL'}
                          </button>
                        </div>
                        <div className="stock-value">
                          {unlimitedItems.includes(item.id) ? (
                            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>∞ Ilimitado</span>
                          ) : (
                            <>
                              {dailyInventory[item.id] || 0}
                              <span className={`stock-badge ${(dailyInventory[item.id] || 0) <= 5 ? 'low' : 'healthy'}`}>
                                {(dailyInventory[item.id] || 0) === 0 ? 'Agotado' : ((dailyInventory[item.id] || 0) <= 5 ? 'Bajo' : 'OK')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {!unlimitedItems.includes(item.id) && (
                        <div className="stock-adjusters">
                          <button onClick={() => adjustStock(item.id, dailyInventory[item.id] || 0, -1)} className="adjust-btn"><Minus size={16} /></button>
                          <button onClick={() => adjustStock(item.id, dailyInventory[item.id] || 0, 1)} className="adjust-btn"><Plus size={16} /></button>
                        </div>
                      )}
                    </div>

                    {editingInventoryId === item.id && (
                      <div style={{ background: 'var(--bg-dark)', padding: '1rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>STOCK MANUAL</label>
                            <input 
                              type="number" 
                              value={editStockValue} 
                              onChange={e => setEditStockValue(e.target.value)}
                              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'white' }}
                            />
                          </div>
                          {role === 'admin' && item.type === 'product' && (
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>PRECIO $</label>
                              <input 
                                type="number" 
                                value={editPriceValue} 
                                onChange={e => setEditPriceValue(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'white' }}
                              />
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => {
                            updateInventoryValue(item.id, 'stock', parseInt(editStockValue))
                            if (role === 'admin' && item.type === 'product') {
                              updateInventoryValue(item.id, 'price', parseInt(editPriceValue))
                            }
                          }}
                          className="add-btn" 
                          style={{ width: '100%', padding: '0.5rem' }}
                        >
                          Guardar Cambios
                        </button>
                      </div>
                    )}

                    <div className="inventory-footer">
                      <div>
                        {role === 'admin' && item.price !== undefined ? (
                          <span className="price-tag">${item.price}</span>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {item.type === 'flavor' ? 'Muffin Base' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {filteredOrders.map(order => {
          const isCocinaView = role === 'cocina'
          return (
          <div key={order.id} style={{ background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            
            {!isCocinaView && (
              <button 
                onClick={() => deleteOrder(order.id, order.shortId)}
                title="Eliminar pedido"
                style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', opacity: 0.7 }}
              >
                <Trash2 size={18} />
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', paddingRight: isCocinaView ? '0' : '2rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {order.customerName}
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {order.shortId && <span style={{ fontSize: '0.75rem', background: '#e5e7eb', padding: '0.1rem 0.4rem', borderRadius: '4px', color: '#4b5563', fontFamily: 'monospace' }}>#{order.shortId}</span>}
                    {order.deliveryDate && (
                      <span style={{ fontSize: '0.75rem', background: 'var(--primary)', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={12} /> {formatDisplayDate(new Date(order.deliveryDate + 'T12:00:00'))}
                      </span>
                    )}
                  </div>
                </h3>
                {!isCocinaView && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>{order.customerPhone}</span>
                    <a 
                      href={`https://wa.me/52${order.customerPhone}?text=${encodeURIComponent(`Hola ${order.customerName}, el total es de $${order.total}. ¿Gustas que te pase los datos para el pago?`)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Enviar WhatsApp"
                      style={{ color: '#25D366', display: 'flex', alignItems: 'center', textDecoration: 'none' }}
                    >
                      <MessageCircle size={16} />
                    </a>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                {getStatusBadge(order.status)}
                {order.deliveryDate && (
                  <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.65rem', fontWeight: 800, padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Calendar size={12} /> {formatDisplayDate(new Date(order.deliveryDate + 'T12:00:00'))}
                  </span>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '1rem', flex: 1 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#888', marginBottom: '0.5rem' }}>PEDIDO</div>
              <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.9rem' }}>
                {order.items.map((item, idx) => (
                  <li key={idx} style={{ marginBottom: '0.25rem' }}>
                    {item.quantity}x {item.name} {item.flavorName ? `(${item.flavorName})` : ''}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ display: 'flex', justifyContent: isCocinaView ? 'flex-end' : 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: 'auto' }}>
              {!isCocinaView && <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>${order.total}</span>}
              
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!isCocinaView && (
                  <button 
                    onClick={() => togglePaymentStatus(order.id, order.isPaid)}
                    type="button"
                    style={{ 
                      padding: '0.4rem 0.6rem', 
                      borderRadius: '6px', 
                      border: 'none', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      background: order.isPaid ? '#dcfce7' : '#f3f4f6',
                      color: order.isPaid ? '#15803d' : '#4b5563',
                      fontWeight: 600,
                      fontSize: '0.85rem'
                    }}
                  >
                    <DollarSign size={14} />
                    {order.isPaid ? 'Pagado' : 'Cobrar'}
                  </button>
                )}

                {(order.status !== 'entregado' && !(isCocinaView && order.status === 'empaque')) && (
                  <button 
                    onClick={() => updateOrderStatus(order.id, order.shortId, order.status)}
                    type="button"
                    style={{ 
                      padding: '0.4rem 0.6rem', 
                      borderRadius: '6px', 
                      border: 'none', 
                      cursor: 'pointer',
                      background: 'var(--primary)',
                      color: 'white',
                      fontWeight: 600,
                      fontSize: '0.85rem'
                    }}
                  >
                    {order.status === 'nuevo' ? 'Cocinar' : (order.status === 'cocinando' ? 'Empacar' : 'Entregar')}
                  </button>
                )}
                {order.status !== 'nuevo' && (
                  <button 
                    onClick={() => resetOrderStatus(order.id, order.shortId)} 
                    style={{ 
                      padding: '0.6rem 1rem', 
                      borderRadius: '8px', 
                      border: '1px solid #ddd', 
                      background: 'white', 
                      color: '#4b5563', 
                      cursor: 'pointer', 
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                    title="Reiniciar pedido a Nuevo"
                  >
                    <RotateCcw size={16} /> Reiniciar
                  </button>
                )}
              </div>
            </div>
          </div>
        )})}
        {filteredOrders.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: '#888' }}>
            No hay pedidos encontrados.
          </div>
        )}
      </div>
      )}
    </div>
  )
}
