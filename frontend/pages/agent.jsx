import React, {useEffect, useState} from 'react'
import StructuredUI from '../components/StructuredUI'
import {CopilotKitProvider, useCopilotKit} from '../components/CopilotKitMock'

function AgentInner(){
  const [notes, setNotes] = useState([])
  const [health, setHealth] = useState('unknown')
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'
  const { lastResponse, sendPrompt } = useCopilotKit()

  async function fetchHealth(){
    try{
      const r = await fetch(backend + '/health')
      const j = await r.json()
      setHealth(j.status)
    }catch(e){ setHealth('error') }
  }

  async function fetchNotes(){
    try{
      const r = await fetch(backend + '/api/v1/obsidian/notes')
      const j = await r.json()
      setNotes(j.notes || [])
    }catch(e){ setNotes([]) }
  }

  useEffect(()=>{ fetchHealth(); fetchNotes()}, [])

  const demoPayload = lastResponse || {
    components: [
      { type: 'Card', title: 'hi-ide Agent', body: 'Demo structured UI for CopilotKit-style responses.' },
      { type: 'Table', title: 'Notes', columns: ['Title','Path'], rows: notes.map(n=>[n.title || '-', n.path || '-']) },
      { type: 'Card', title: 'Backend', body: `health: ${health} \n backend: ${backend}` },
      { type: 'ButtonGroup', buttons: [
        { label: 'Refresh Notes', action: 'refresh-notes' },
        { label: 'Health Check', action: 'health-check' },
        { label: 'Open Backend', href: backend }
      ]},
      { type: 'ScrollArea', body: JSON.stringify({notes}, null, 2) }
    ]
  }

  const handlers = {
    'refresh-notes': fetchNotes,
    'health-check': fetchHealth,
    'refresh': () => { fetchNotes(); fetchHealth() }
  }

  return (
    <div className="container">
      <h1>Agent demo (CopilotKit)</h1>

      <div style={{marginBottom:12}}>
        <input id="prompt" placeholder="Ask the agent..." style={{padding:8,width:'60%'}} />
        <button style={{marginLeft:8,padding:'8px 12px'}} onClick={async ()=>{
          const prompt = document.getElementById('prompt').value || 'Hello'
          await sendPrompt(prompt)
        }}>Send</button>
      </div>

      <StructuredUI payload={demoPayload} handlers={handlers} />
      <p style={{marginTop:16}}><a href="/">Back</a></p>
    </div>
  )
}

export default function AgentPage(){
  return (
    <CopilotKitProvider>
      <AgentInner />
    </CopilotKitProvider>
  )
}
