import { AvatarService } from './members/avatar.service.js'
import { MemberService } from './members/member.service.js'
import { MemberViews } from './members/member-views.js'

type MemberDeps = Omit<ConstructorParameters<typeof MemberService>[0], 'views'> &
  Pick<ConstructorParameters<typeof AvatarService>[0], 'files'>

/** The people of the organization and their photos (ADR-0039), shown through one set of views. */
export const buildMembers = (deps: MemberDeps) => {
  const views = new MemberViews(deps.files)
  return {
    members: new MemberService({ ...deps, views }),
    avatars: new AvatarService({ ...deps, views })
  }
}
