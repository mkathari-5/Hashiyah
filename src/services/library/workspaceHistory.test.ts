import { afterEach, describe, expect, it } from 'vitest'
import {
  pushLibraryHistory,
  pushStudyHistory,
  readWorkspaceHash,
  readWorkspaceHistory,
  replaceStudyHistory,
} from '@/services/library/workspaceHistory'

afterEach(() => {
  window.location.hash = ''
})

describe('workspace history', () => {
  it('parses library and study hashes without using titles', () => {
    expect(readWorkspaceHash('#/library')).toEqual({ view: 'library', nodeId: null })
    expect(readWorkspaceHash('#/study/lib_abc')).toEqual({ view: 'study', nodeId: 'lib_abc' })
    expect(readWorkspaceHash('#/study/lib%2Fslash')).toEqual({ view: 'study', nodeId: 'lib/slash' })
    expect(readWorkspaceHash('#/study/Manhaj%20as-Salikeen')).toEqual({
      view: 'study',
      nodeId: 'Manhaj as-Salikeen',
    })
  })

  it('pushes a study entry so Back can return to the homepage', () => {
    replaceStudyHistory('lib_1')
    expect(readWorkspaceHistory()).toEqual({ view: 'study', nodeId: 'lib_1' })
    expect(window.location.hash).toBe('#/study/lib_1')
    pushLibraryHistory()
    expect(readWorkspaceHistory()).toEqual({ view: 'library', nodeId: null })
    expect(window.location.hash).toBe('#/library')
  })

  it('does not duplicate the same study entry', () => {
    const start = window.history.length
    pushStudyHistory('lib_1')
    pushStudyHistory('lib_1')
    expect(window.history.length - start).toBeLessThanOrEqual(1)
  })
})
