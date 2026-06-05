import React from 'react'
import '../styles/globals.css'
import CopilotKitMock from '../components/CopilotKitMock'

export default function MyApp({ Component, pageProps }) {
  // Use the local CopilotKit mock/provider only
  const Provider = CopilotKitMock
  return (
    <Provider>
      <Component {...pageProps} />
    </Provider>
  )
}
