import React, { useState, useEffect } from 'react'
import { fetchUsers, fetchMe, createUser, updateUser, deleteUser } from '../api'
import { Users as UsersIcon, Plus, Trash2, X, Save, Pencil, Shield, User as UserIcon } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
        <Shield size={11} /> admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
      <UserIcon size={11} /> editor
    </span>
  )
}

function UserRow({ user, me, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fio: user.fio || '', role: user.role, password: '' })
  const [error, setError] = useState('')

  const canEdit = me.role === 'admin'
  const isSelf = me.id === user.id

  const handleSave = async () => {
    setError('')
    try {
      const body = {}
      if (form.fio !== (user.fio || '')) body.fio = form.fio
      if (form.role !== user.role) body.role = form.role
      if (form.password) body.password = form.password
      const updated = await updateUser(user.id, body)
      onSaved(updated)
      setEditing(false)
      setForm({ ...form, password: '' })
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async () => {
    if (isSelf) { alert('Нельзя удалить собственный аккаунт'); return }
    if (!confirm(`Удалить пользователя "${user.username}"?`)) return
    try {
      await deleteUser(user.id)
      onDeleted(user.id)
    } catch (e) { alert(e.message) }
  }

  if (editing) {
    return (
      <tr className="border-t bg-blue-50/30">
        <td className="px-4 py-3 font-mono text-sm">{user.username}</td>
        <td className="px-4 py-3">
          <input
            value={form.fio}
            onChange={(e) => setForm({ ...form, fio: e.target.value })}
            placeholder="ФИО"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </td>
        <td className="px-4 py-3">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            disabled={isSelf && user.role === 'admin'}
            className="border rounded px-2 py-1 text-sm"
            title={isSelf && user.role === 'admin' ? 'Нельзя снять роль admin с самого себя' : ''}
          >
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
        </td>
        <td className="px-4 py-3">
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Новый пароль (пусто = не менять)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </td>
        <td className="px-4 py-3" colSpan={2}>
          {error && <div className="text-red-600 text-xs mb-1">{error}</div>}
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex items-center gap-1"
            >
              <Save size={12} /> Сохранить
            </button>
            <button
              onClick={() => { setEditing(false); setForm({ fio: user.fio || '', role: user.role, password: '' }) }}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
            >
              Отмена
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t hover:bg-gray-50">
      <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800">
        {user.username}
        {isSelf && <span className="ml-2 text-xs text-blue-600">(вы)</span>}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{user.fio || <span className="text-gray-400">—</span>}</td>
      <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
      <td className="px-4 py-3 text-sm text-gray-500 font-mono">••••••</td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-3 w-28">
        {canEdit && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="Редактировать"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={handleDelete}
              disabled={isSelf}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              title={isSelf ? 'Нельзя удалить самого себя' : 'Удалить'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function UsersList() {
  const [users, setUsers] = useState([])
  const [me, setMe] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', fio: '', role: 'editor' })
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMe().then(setMe).catch(() => {})
    fetchUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  const handleCreate = async () => {
    setError('')
    if (!newUser.username.trim() || !newUser.password) {
      setError('Логин и пароль обязательны'); return
    }
    if (newUser.password.length < 6) {
      setError('Пароль минимум 6 символов'); return
    }
    try {
      const created = await createUser({
        username: newUser.username.trim(),
        password: newUser.password,
        fio: newUser.fio || null,
        role: newUser.role,
      })
      setUsers(prev => [...prev, created].sort((a, b) => a.username.localeCompare(b.username)))
      setShowCreate(false)
      setNewUser({ username: '', password: '', fio: '', role: 'editor' })
    } catch (e) { setError(e.message) }
  }

  if (!me) return <div className="p-8 text-gray-500">Загрузка...</div>

  const isAdmin = me.role === 'admin'

  return (
    <div className="p-8">
      <PageHeader icon={UsersIcon} title={`Пользователи (${users.length})`}>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-semibold"
          >
            <Plus size={16} /> Новый пользователь
          </button>
        )}
      </PageHeader>

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 mb-4">
          Создание и изменение пользователей доступно только администраторам.
          Ваш аккаунт имеет роль <strong>editor</strong>.
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Новый пользователь</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-3 text-sm">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Логин</label>
                <input
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  autoComplete="off"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  autoComplete="new-password"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Минимум 6 символов.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ФИО</label>
                <input
                  value={newUser.fio}
                  onChange={(e) => setNewUser({ ...newUser, fio: e.target.value })}
                  placeholder="Иванов Иван Иванович"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Роль</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="editor">editor — редактирует схемы и узлы</option>
                  <option value="admin">admin — плюс управление пользователями</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Отмена
              </button>
              <button onClick={handleCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold">
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-40">Логин</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">ФИО</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-28">Роль</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-40">Пароль</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-28">Создан</th>
              <th className="w-28"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <UserRow
                key={u.id}
                user={u}
                me={me}
                onSaved={(updated) => setUsers(prev => prev.map(p => p.id === updated.id ? updated : p))}
                onDeleted={(id) => setUsers(prev => prev.filter(p => p.id !== id))}
              />
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Нет пользователей</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
