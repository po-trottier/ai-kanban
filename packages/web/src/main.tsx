import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'

// Board UI populated via TDD (task: frontend board UI).
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<StrictMode>{null}</StrictMode>)
}
