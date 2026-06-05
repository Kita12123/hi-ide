import React from 'react'

function Card({title, body}){
  return (
    <div className="hi-card">
      <h3>{title}</h3>
      <div>{body}</div>
    </div>
  )
}

function Table({columns, rows}){
  return (
    <table className="hi-table">
      <thead>
        <tr>
          {columns.map((c,i)=>(<th key={i} className="hi-table-th">{c}</th>))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r,ri)=>(
          <tr key={ri}>
            {r.map((cell,ci)=>(<td key={ci} className="hi-table-td">{cell}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ButtonGroup({buttons}){
  return (
    <div className="hi-button-group">
      {buttons.map((b,i)=>(
        <button key={i} onClick={b.onClick || (()=>{})} className="hi-button">{b.label}</button>
      ))}
    </div>
  )
}

function ScrollArea({children}){
  return (
    <div className="hi-scrollarea">
      {children}
    </div>
  )
}

export default function StructuredUI({payload, handlers={}}){
  if (!payload || !payload.components) return null
  return (
    <div>
      {payload.components.map((comp,idx)=>{
        switch(comp.type){
          case 'Card':
            return <Card key={idx} title={comp.title} body={comp.body} />
          case 'Table':
            return <Table key={idx} columns={comp.columns||[]} rows={comp.rows||[]} />
          case 'ButtonGroup':
            // wire buttons to handlers by action id if present
            return <ButtonGroup key={idx} buttons={(comp.buttons||[]).map(b=>({
              ...b,
              onClick: handlers[b.action] || b.onClick || (()=>{ if (b.href) window.open(b.href); })
            }))} />
          case 'ScrollArea':
            return <ScrollArea key={idx}>{comp.body}</ScrollArea>
          default:
                      return <pre key={idx} className="hi-pre">{JSON.stringify(comp,null,2)}</pre>
        }
      })}
    </div>
  )
}
