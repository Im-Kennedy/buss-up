import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
//leaflet first: it ships its own popup/control colors, and whatever loads last
//wins. our theme has to come after it or dark mode leaves white popups behind
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
