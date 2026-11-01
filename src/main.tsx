import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {ChakraProvider, createSystem, defaultConfig} from '@chakra-ui/react'

const system = createSystem (defaultConfig, {preflight: false})

// View: implementation-architecture.svg#O1
// Mount the application and UI provider. This establishes presentation context;
// medical records are fetched from the backend rather than embedded in the page.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChakraProvider value={system}><App /></ChakraProvider>
  </StrictMode>,
)
