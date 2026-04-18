import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchSchemas, setActiveSchemaId, getActiveSchemaId } from './api'

const SchemaCtx = createContext(null)

export function SchemaProvider({ children }) {
  const [schemas, setSchemas] = useState([])
  const [schemaId, setSchemaIdState] = useState(() => getActiveSchemaId())
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchSchemas()
      setSchemas(list)
      // If the active schema no longer exists (e.g. deleted), fall back to
      // the first available — or endo-bot which must always exist.
      const ids = list.map(s => s.id)
      if (!ids.includes(schemaId)) {
        const fallback = ids.includes('endo-bot') ? 'endo-bot' : (ids[0] || 'endo-bot')
        setSchemaIdState(fallback)
        setActiveSchemaId(fallback)
      }
    } catch (e) {
      console.warn('Failed to load schemas', e)
    } finally {
      setLoading(false)
    }
  }, [schemaId])

  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const switchSchema = useCallback((sid) => {
    setSchemaIdState(sid)
    setActiveSchemaId(sid)
    // Force a full page reload so every page picks up the new schema
    // cleanly (avoids half-loaded state across routes).
    window.location.reload()
  }, [])

  return (
    <SchemaCtx.Provider value={{ schemas, schemaId, switchSchema, reload, loading }}>
      {children}
    </SchemaCtx.Provider>
  )
}

export function useSchemaContext() {
  const ctx = useContext(SchemaCtx)
  if (!ctx) throw new Error('useSchemaContext must be used within SchemaProvider')
  return ctx
}
