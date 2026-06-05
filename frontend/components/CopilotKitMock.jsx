import React, {createContext, useContext, useState, useEffect, useRef} from 'react'

const CopilotKitContext = createContext(null)

// Attempt to dynamically load a real CopilotKit SDK on client. If unavailable, fall back to mock.
export function CopilotKitProvider({children}){
  const [lastResponse, setLastResponse] = useState(null)
  const realSendRef = useRef(null)
  const [realAvailable, setRealAvailable] = useState(false)

  useEffect(()=>{
    // run only on client
    if (typeof window === 'undefined') return

    const tryImports = async ()=>{
      const candidates = [
        '@copilotkit/react-core',
        'copilotkit',
        '@copilotkit/runtime',
      ]
      for (const name of candidates){
        try{
          // dynamic import
          const mod = await import(/* webpackIgnore: true */ name)
          // Heuristics: look for an exported function to create client / send messages
          if (mod && (mod.createCopilotClient || mod.createCopilotRuntime || mod.Copilot)){
            console.log('CopilotKit SDK loaded from', name)
            // Example adapter: if createCopilotClient exists, use it to make a client
            let client = null
            if (mod.createCopilotClient) {
              try{
                client = mod.createCopilotClient({ apiKey: process.env.NEXT_PUBLIC_COPILOT_API_KEY })
              }catch(e){
                // ignore creation errors
                client = null
              }
            }
            // If client has a simple send API
            if (client && (client.send || client.call || client.createThread)){
              realSendRef.current = async (prompt)=>{
                // adapt to different client method names
                if (client.send) return client.send(prompt)
                if (client.call) return client.call(prompt)
                if (client.createThread) return client.createThread({ prompt })
                return null
              }
              setRealAvailable(true)
              return
            }
            // fallback: if module itself exports a function 'send' or similar
            if (mod.send || mod.call){
              realSendRef.current = async (prompt) => {
                if (mod.send) return mod.send(prompt)
                if (mod.call) return mod.call(prompt)
                return null
              }
              setRealAvailable(true)
              return
            }
          }
        }catch(e){
          // ignore import failures
        }
      }
      console.log('No CopilotKit SDK detected, using mock provider')
    }
    tryImports()
  }, [])

  // generic sendPrompt that delegates to real SDK when available
  async function sendPrompt(prompt){
    if (realSendRef.current){
      try{
        const realResult = await realSendRef.current(prompt)
        if (realResult && realResult.components) {
          setLastResponse(realResult)
          return realResult
        }
        const payload = { components: [ { type: 'Card', title: 'Agent reply', body: String(realResult) } ] }
        setLastResponse(payload)
        return payload
      }catch(e){
        console.error('CopilotKit real send failed, falling back to proxy/mock', e)
      }
    }

    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'
    const apiKey = process.env.NEXT_PUBLIC_BACKEND_API_KEY || null

    // Try server-side start + SSE streaming
    try{
      const startRes = await fetch(backend + '/api/v1/agent/start', {
        method: 'POST',
        headers: Object.assign({'Content-Type':'application/json'}, apiKey ? { 'x-api-key': apiKey } : {}),
        body: JSON.stringify({ prompt })
      })
      const startJson = await startRes.json()
      if (!startRes.ok || !startJson || !startJson.job_id){
        throw new Error('Agent start failed')
      }
      const jobId = startJson.job_id
      let accumulated = ''

      // update UI initial payload
      const initialPayload = { components: [ { type: 'Card', title: 'Agent (streaming)', body: 'Starting...' }, { type: 'ScrollArea', body: '' } ] }
      setLastResponse(initialPayload)

      const streamUrl = backend.replace(/\/\/$/, '') + '/api/v1/agent/stream/' + jobId

      // Choose EventSource when no API key needed; otherwise use fetch streaming
      if (!apiKey && typeof EventSource !== 'undefined'){
        await new Promise((resolve, reject)=>{
          const es = new EventSource(streamUrl)
          es.onmessage = (e)=>{
            // append data
            accumulated += e.data + '\n'
            setLastResponse({ components: [ { type: 'Card', title: 'Agent (streaming)', body: 'Streaming output' }, { type: 'ScrollArea', body: accumulated } ] })
          }
          es.addEventListener('done', ()=>{
            es.close()
            resolve()
          })
          es.onerror = (err)=>{
            es.close()
            reject(err)
          }
        })
      } else {
        // fetch streaming and parse SSE-like chunks
        const res = await fetch(streamUrl, {
          headers: apiKey ? { 'x-api-key': apiKey } : {}
        })
        if (!res.ok || !res.body) throw new Error('Stream connection failed')
        const reader = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        while(true){
          const {done, value} = await reader.read()
          if (done) break
          buffer += decoder.decode(value, {stream:true})
          // parse complete SSE events separated by double newlines
          let parts = buffer.split('\n\n')
          buffer = parts.pop() || ''
          for(const part of parts){
            if (!part.trim()) continue
            if (part.startsWith('event:')){
              if (part.includes('done')){
                // finished
                break
              }
            }
            // extract data lines
            const lines = part.split('\n')
            for(const line of lines){
              if (line.startsWith('data:')){
                const data = line.replace(/^data:\s?/, '')
                accumulated += data + '\n'
                setLastResponse({ components: [ { type: 'Card', title: 'Agent (streaming)', body: 'Streaming output' }, { type: 'ScrollArea', body: accumulated } ] })
              }
            }
          }
        }
      }

      // final payload
      const finalPayload = { components: [ { type: 'Card', title: 'Agent (complete)', body: 'Done' }, { type: 'ScrollArea', body: accumulated } ] }
      setLastResponse(finalPayload)
      return finalPayload
    }catch(e){
      console.warn('Streaming proxy failed, falling back to sync proxy and mock:', e)
      // fallback to previous single-call proxy
      try{
        const res = await fetch(backend + '/api/v1/agent', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) })
        const j = await res.json()
        if (res.ok && j && j.success && j.text){
          const payload = { components: [ { type: 'Card', title: 'Agent reply', body: j.text }, { type: 'ScrollArea', body: j.text } ] }
          setLastResponse(payload)
          return payload
        }
      }catch(err){
        console.warn('Sync proxy failed:', err)
      }
    }

    // Mock fallback behavior
    await new Promise(r=>setTimeout(r, 300))
    const payload = {
      components: [
        { type: 'Card', title: 'Agent reply (mock)', body: `Received prompt: ${prompt}` },
        { type: 'Table', title: 'Quick facts', columns: ['Key','Value'], rows: [['Model','Copilot (mock)'], ['Prompt length', String(prompt.length)]] },
        { type: 'ButtonGroup', buttons: [
          { label: 'Refresh', action: 'refresh' },
          { label: 'Open docs', href: 'https://docs.langchain.com/oss/python/langchain/frontend/integrations/copilotkit' }
        ]},
        { type: 'ScrollArea', body: JSON.stringify({prompt}, null, 2) }
      ]
    }

    setLastResponse(payload)
    return payload
  }

  return (
    <CopilotKitContext.Provider value={{lastResponse, sendPrompt, realAvailable}}>
      {children}
    </CopilotKitContext.Provider>
  )
}

export function useCopilotKit(){
  const ctx = useContext(CopilotKitContext)
  if (!ctx) throw new Error('useCopilotKit must be used within CopilotKitProvider')
  return ctx
}

export default CopilotKitProvider
