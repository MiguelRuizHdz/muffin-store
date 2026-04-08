import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Store from './pages/Store'
import Admin from './pages/Admin'
import { Analytics } from '@vercel/analytics/react'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/" element={<Store />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}

export default App
