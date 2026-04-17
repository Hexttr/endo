import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { isLoggedIn, logout, login } from './api'
import Dashboard from './pages/Dashboard'
import TreeView from './pages/TreeView'
import NodeList from './pages/NodeList'
import NodeEditor from './pages/NodeEditor'
import FinalsList from './pages/FinalsList'
import FinalEditor from './pages/FinalEditor'
import SessionsList from './pages/SessionsList'
import { LayoutDashboard, GitBranch, List, FileText, Users, LogOut } from 'lucide-react'

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await login(username, password)
      onLogin()
    } catch {
      setError('Неверные учётные данные')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-indigo-900">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2">Endo Bot</h1>
        <p className="text-gray-500 text-center mb-6">Панель управления</p>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Логин"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-semibold">
            Войти
          </button>
        </form>
      </div>
    </div>
  )
}

function Layout({ children, onLogout }) {
  const navigate = useNavigate()
  const links = [
    { to: '/', icon: <LayoutDashboard size={18} />, label: 'Обзор' },
    { to: '/tree', icon: <GitBranch size={18} />, label: 'Дерево' },
    { to: '/nodes', icon: <List size={18} />, label: 'Узлы' },
    { to: '/finals', icon: <FileText size={18} />, label: 'Диагнозы' },
    { to: '/sessions', icon: <Users size={18} />, label: 'Сессии' },
  ]

  return (
    <div className="min-h-screen flex">
      <nav className="w-64 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-lg font-bold">Endo Bot Admin</h1>
          <p className="text-gray-400 text-xs mt-1">Управление логикой бота</p>
        </div>
        <div className="flex-1 py-4">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="flex items-center gap-3 px-6 py-3 text-gray-300 hover:bg-gray-800 hover:text-white transition"
            >
              {l.icon}
              <span>{l.label}</span>
            </Link>
          ))}
        </div>
        <button
          onClick={() => { onLogout(); navigate('/'); }}
          className="flex items-center gap-3 px-6 py-4 text-gray-400 hover:text-white border-t border-gray-700 transition"
        >
          <LogOut size={18} />
          <span>Выйти</span>
        </button>
      </nav>
      <main className="flex-1 bg-gray-50 overflow-auto">{children}</main>
    </div>
  )
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())

  const handleLogout = () => {
    logout()
    setLoggedIn(false)
  }

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />
  }

  return (
    <BrowserRouter>
      <Layout onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tree" element={<TreeView />} />
          <Route path="/nodes" element={<NodeList />} />
          <Route path="/nodes/:nodeId" element={<NodeEditor />} />
          <Route path="/finals" element={<FinalsList />} />
          <Route path="/finals/:finalId" element={<FinalEditor />} />
          <Route path="/sessions" element={<SessionsList />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
