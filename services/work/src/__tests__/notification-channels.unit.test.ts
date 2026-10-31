import { describe, expect, it } from 'bun:test'

import { chosenChannels, settleChannels } from '../notifications/schemas.js'

/** How a person's choice of channels is kept and read back (escopo-mvp 4.6), with nothing but the functions. */
describe('a choice of channels', () => {
  it('is kept once each, in a fixed order, with the panel added to any other', () => {
    expect(settleChannels('mentioned', ['slack', 'email', 'slack'])).toEqual(['in_app', 'email', 'slack'])
    expect(settleChannels('mentioned', ['in_app'])).toEqual(['in_app'])
    expect(settleChannels('mentioned', [])).toEqual([])
  })

  it('keeps a summary to e-mail, and refuses another channel for it', () => {
    expect(settleChannels('weekly_summary', ['email'])).toEqual(['email'])
    expect(() => settleChannels('weekly_summary', ['in_app'])).toThrow(
      'Notices of kind "weekly_summary" do not go by "in_app"'
    )
  })
})

describe('the channels read back', () => {
  it('are the default when nothing was chosen or what is kept is unreadable', () => {
    expect(chosenChannels('assigned', undefined)).toEqual(['in_app', 'email'])
    expect(chosenChannels('assigned', 'email')).toEqual(['in_app', 'email'])
    expect(chosenChannels('weekly_summary', undefined)).toEqual(['email'])
  })

  it('are what was chosen, an empty list included', () => {
    expect(chosenChannels('assigned', ['in_app', 'slack'])).toEqual(['in_app', 'slack'])
    expect(chosenChannels('assigned', [])).toEqual([])
  })
})
