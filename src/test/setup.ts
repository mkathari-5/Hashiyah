import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Unmount anything a test rendered.
 *
 * Testing Library registers this itself when a test runner exposes its hooks
 * globally; this project does not run with `globals`, so without it every
 * rendered tree stays in the document and the next test's queries find the
 * previous test's editor first.
 */
afterEach(cleanup)
