import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameDataProvider } from './state'
import { AssetProvider } from './theme'
import './styles.css'
import './styles/meta.css'
import './styles/battle.css'
import './styles/gacha.css'
import './styles/scenery.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssetProvider>
      <GameDataProvider>
        <App />
      </GameDataProvider>
    </AssetProvider>
  </StrictMode>,
)
