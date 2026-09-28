import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AssetProvider } from './theme'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssetProvider>
      <App />
    </AssetProvider>
  </StrictMode>,
)
