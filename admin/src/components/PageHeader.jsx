import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * Единый заголовок страницы: иконка + h1 (text-2xl) + опционально подзаголовок.
 */
export function PageHeader({ icon: Icon, title, subtitle, backTo, children, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 mb-6 ${className}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {backTo && (
          <Link
            to={backTo}
            className="mt-2.5 text-gray-500 hover:text-gray-800 shrink-0 rounded-lg p-1 hover:bg-gray-100 transition"
            aria-label="Назад"
          >
            <ArrowLeft size={22} strokeWidth={2} />
          </Link>
        )}
        {Icon && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-indigo-100 text-blue-700 ring-1 ring-blue-100/80 shadow-sm">
            <Icon className="h-6 w-6" strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}
