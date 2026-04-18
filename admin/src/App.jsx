import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { isLoggedIn, logout, login } from './api'
import { SchemaProvider, useSchemaContext } from './schema-context'
import Dashboard from './pages/Dashboard'
import TreeView from './pages/TreeView'
import NodeList from './pages/NodeList'
import NodeEditor from './pages/NodeEditor'
import FinalsList from './pages/FinalsList'
import FinalEditor from './pages/FinalEditor'
import SessionsList from './pages/SessionsList'
import SchemasList from './pages/SchemasList'
import Playground from './pages/Playground'
import {
  LayoutDashboard, GitBranch, List, FileText, Users, LogOut,
  Layers, ChevronDown, Play, User, Lock,
} from 'lucide-react'

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
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md border border-white/10">
        <div className="flex flex-col items-center text-center mb-8">
          <img
            src="/logo-w.png"
            alt="МедЛогика"
            className="h-24 w-auto max-w-[220px] object-contain drop-shadow-sm"
          />
          <h1 className="text-2xl font-bold text-gray-900 mt-5 tracking-tight">МедЛогика</h1>
          <p className="text-gray-500 text-sm mt-1.5">Панель управления</p>
        </div>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <User
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="text"
              placeholder="Логин"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>
          <div className="relative">
            <Lock
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 font-semibold shadow-md shadow-blue-600/20 transition"
          >
            Войти
          </button>
        </form>
      </div>
    </div>
  )
}

function SchemaSwitcher() {
  const { schemas, schemaId, switchSchema } = useSchemaContext()
  const [open, setOpen] = useState(false)
  const active = schemas.find(s => s.id === schemaId)
  return (
    <div className="relative px-4 py-3 border-b border-gray-700">
      <button
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={16} className="shrink-0 text-blue-300" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase text-gray-400 tracking-wide">Схема</div>
            <div className="text-sm font-semibold truncate">
              {active?.name || schemaId}
            </div>
          </div>
        </div>
        <ChevronDown size={16} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-4 right-4 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-80 overflow-auto">
          {schemas.map(s => (
            <button
              key={s.id}
              onClick={() => { setOpen(false); switchSchema(s.id) }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 ${s.id === schemaId ? 'bg-gray-700 text-white' : 'text-gray-300'}`}
            >
              <div className="font-semibold">{s.name}</div>
              <div className="text-[10px] text-gray-500 font-mono">{s.id}</div>
            </button>
          ))}
          <Link
            to="/schemas"
            onClick={() => setOpen(false)}
            className="block text-center px-3 py-2 text-sm border-t border-gray-700 text-blue-400 hover:bg-gray-700"
          >
            Управление схемами →
          </Link>
        </div>
      )}
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
    { to: '/playground', icon: <Play size={18} />, label: 'Playground' },
    { to: '/sessions', icon: <Users size={18} />, label: 'Сессии' },
    { to: '/schemas', icon: <Layers size={18} />, label: 'Схемы' },
  ]

  return (
    <div className="min-h-screen flex">
      <nav className="w-64 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="p-6 border-b border-gray-700">
          <div className="flex flex-col items-center text-center">
            <Link
              to="/"
              className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 hover:opacity-95 transition-opacity"
              title="На главную"
            >
              <img
                src="/logo-w.png"
                alt="МедЛогика"
                className="h-28 w-auto max-w-[220px] object-contain mx-auto"
              />
            </Link>
            <h1 className="text-lg font-semibold text-white mt-4 tracking-tight">МедЛогика</h1>
            <p className="text-gray-400 text-xs mt-2 leading-snug px-1">
              Инструменты для принятия врачебных решений
            </p>
          </div>
        </div>
        <SchemaSwitcher />
        <div className="flex-1 py-4 overflow-auto">
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
      <SchemaProvider>
        <Layout onLogout={handleLogout}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tree" element={<TreeView />} />
            <Route path="/nodes" element={<NodeList />} />
            <Route path="/nodes/:nodeId" element={<NodeEditor />} />
            <Route path="/finals" element={<FinalsList />} />
            <Route path="/finals/:finalId" element={<FinalEditor />} />
            <Route path="/sessions" element={<SessionsList />} />
            <Route path="/schemas" element={<SchemasList />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </SchemaProvider>
    </BrowserRouter>
  )
}
