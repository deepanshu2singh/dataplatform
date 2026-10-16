import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { editorSanitizerAlias, verifyEditorSanitizer } from './build/editorSanitizer.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), verifyEditorSanitizer()],
  resolve: { alias: [editorSanitizerAlias] },
})
