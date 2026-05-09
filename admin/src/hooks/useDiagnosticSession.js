import { useState, useEffect, useRef, useCallback } from 'react'

export function useDiagnosticSession({
  schemaId = 'endo-bot',
  userIdPrefix = 'diagnostic',
  startSessionApi,
  submitAnswerApi,
  autoStart = true,
}) {
  const [sessionId, setSessionId] = useState(null)
  const [currentNode, setCurrentNode] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [fieldInputs, setFieldInputs] = useState({})
  const [multiSelected, setMultiSelected] = useState(new Set())
  const [finalResult, setFinalResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collectedData, setCollectedData] = useState({})
  const [unknownFlags, setUnknownFlags] = useState([])
  const scrollRef = useRef(null)
  const startSessionApiRef = useRef(startSessionApi)
  const submitAnswerApiRef = useRef(submitAnswerApi)
  const autoAdvancedNodeIdRef = useRef(null)

  useEffect(() => {
    startSessionApiRef.current = startSessionApi
  }, [startSessionApi])

  useEffect(() => {
    submitAnswerApiRef.current = submitAnswerApi
  }, [submitAnswerApi])

  const addQuestionToTranscript = useCallback((node) => {
    setTranscript(t => [...t, { role: 'bot', kind: 'question', node }])
  }, [])

  const startSession = useCallback(async () => {
    setError('')
    setLoading(true)
    setFinalResult(null)
    setTranscript([])
    setCollectedData({})
    setUnknownFlags([])
    setMultiSelected(new Set())
    setFieldInputs({})
    autoAdvancedNodeIdRef.current = null
    try {
      const userId = `${userIdPrefix}-${Date.now()}`
      const data = await startSessionApiRef.current(userId, { schemaId })
      setSessionId(data.session_id)
      if (data.current_node) {
        setCurrentNode(data.current_node)
        addQuestionToTranscript(data.current_node)
      } else {
        setCurrentNode(null)
      }
      setCollectedData(data.collected_data || {})
      setUnknownFlags(data.unknown_flags || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [addQuestionToTranscript, schemaId, userIdPrefix])

  useEffect(() => {
    if (autoStart) {
      startSession()
    }
  }, [autoStart, startSession])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript, finalResult])

  const submitAnswer = useCallback(async (answer, displayLabel, options = {}) => {
    if (!sessionId || !currentNode) return
    const { silent = false } = options
    setLoading(true)
    setError('')
    if (!silent) {
      setTranscript(t => {
        const last = t[t.length - 1]
        const updated = t.slice()
        if (last && last.kind === 'question') {
          updated[updated.length - 1] = { ...last, kind: 'answered', answerLabel: displayLabel }
        }
        updated.push({ role: 'user', kind: 'answer', text: displayLabel })
        return updated
      })
    }

    try {
      const data = await submitAnswerApiRef.current(sessionId, currentNode.id, answer, { schemaId })
      setCollectedData(data.collected_data || {})
      setUnknownFlags(data.unknown_flags || [])
      setMultiSelected(new Set())
      setFieldInputs({})

      if (data.final) {
        setFinalResult({ type: 'final', payload: data.final, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }

      const nextNode = data.current_node
      if (nextNode?.is_pending) {
        setFinalResult({ type: 'pending', node: nextNode, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }

      if (nextNode?.is_terminal) {
        setFinalResult({ type: 'terminal', node: nextNode, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }

      if (nextNode) {
        setCurrentNode(nextNode)
        addQuestionToTranscript(nextNode)
      } else if (data.status === 'completed') {
        setFinalResult({ type: 'completed', flags: data.unknown_flags || [] })
        setCurrentNode(null)
      } else {
        setError('Алгоритм не смог определить следующий шаг.')
        setCurrentNode(null)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [addQuestionToTranscript, currentNode, schemaId, sessionId])

  useEffect(() => {
    if (!currentNode || loading || finalResult) return

    const shouldAutoAdvance =
      currentNode.input_type === 'info' &&
      !currentNode.is_terminal &&
      !currentNode.is_pending &&
      (currentNode.options?.length || 0) === 0

    if (!shouldAutoAdvance) return
    if (autoAdvancedNodeIdRef.current === currentNode.id) return

    autoAdvancedNodeIdRef.current = currentNode.id
    submitAnswer('next', 'Далее', { silent: true })
  }, [currentNode, finalResult, loading, submitAnswer])

  const handleChoice = useCallback((option) => {
    submitAnswer(option.option_id, option.label)
  }, [submitAnswer])

  const handleUnknown = useCallback(() => {
    submitAnswer('unknown', 'Данные отсутствуют')
  }, [submitAnswer])

  const handleNext = useCallback(() => {
    submitAnswer('next', 'Далее')
  }, [submitAnswer])

  const handleMultiDone = useCallback(() => {
    const selected = Array.from(multiSelected)
    if (selected.length === 0) {
      submitAnswer([], 'Ничего не отмечено')
      return
    }
    const labels = (currentNode?.options || [])
      .filter(o => selected.includes(o.option_id))
      .map(o => o.label)
    submitAnswer(selected, labels.join(' + '))
  }, [currentNode?.options, multiSelected, submitAnswer])

  const handleMultiUnknown = useCallback(() => {
    submitAnswer('unknown', 'Данные отсутствуют')
  }, [submitAnswer])

  const toggleMulti = useCallback((optionId) => {
    setMultiSelected(s => {
      const next = new Set(s)
      if (next.has(optionId)) next.delete(optionId)
      else next.add(optionId)
      return next
    })
  }, [])

  const handleFieldChange = useCallback((fieldId, value) => {
    setFieldInputs(prev => ({ ...prev, [fieldId]: value }))
  }, [])

  const handleNumericSubmit = useCallback(() => {
    if (!currentNode) return
    const fields = currentNode.extra?.fields || []

    if (fields.length === 0) {
      const raw = (fieldInputs.__raw || '').trim()
      if (!raw) return
      const values = {}
      raw.split(/\s+/).forEach(pair => {
        if (pair.includes('=')) {
          const [k, v] = pair.split('=')
          const num = parseFloat(v.replace(',', '.'))
          if (!Number.isNaN(num)) values[k.trim()] = num
        }
      })
      submitAnswer(Object.keys(values).length > 0 ? values : raw, raw)
      return
    }

    const values = {}
    const labels = []
    fields.forEach(field => {
      const raw = (fieldInputs[field.id] || '').trim()
      if (!raw) return
      const num = parseFloat(raw.replace(',', '.'))
      if (!Number.isNaN(num)) {
        values[field.id] = num
        labels.push(`${field.label}: ${raw}`)
      }
    })

    if (Object.keys(values).length === 0) return
    submitAnswer(values, labels.join('; '))
  }, [currentNode, fieldInputs, submitAnswer])

  return {
    sessionId,
    currentNode,
    transcript,
    fieldInputs,
    multiSelected,
    finalResult,
    loading,
    error,
    collectedData,
    unknownFlags,
    scrollRef,
    startSession,
    handleChoice,
    handleUnknown,
    handleNext,
    handleMultiDone,
    handleMultiUnknown,
    toggleMulti,
    handleFieldChange,
    handleNumericSubmit,
  }
}
