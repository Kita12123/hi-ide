import React, {useEffect, useState} from 'react'

export default function Home(){
  const [health, setHealth] = useState('unknown')

  useEffect(()=>{
    fetch((process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000') + '/health')
      .then(r=>r.json()).then(j=>setHealth(j.status)).catch(()=>setHealth('error'))
  },[])

  return (
    <div style={{fontFamily:'sans-serif',padding:24}}>
      <h1>hi-ide (frontend stub)</h1>
      <p>Backend health: {health}</p>
      <p>Run backend: uvicorn backend.app.main:app --reload --port 8000</p>
      <p>Run frontend: npm run dev (in frontend folder)</p>
    </div>
  )
}
