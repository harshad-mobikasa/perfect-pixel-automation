import { redirect } from 'next/navigation'
import AppHome from '../components/app-home'
import { getSessionUser } from '../lib/require-auth.js'
import { listAccessibleProjects, listVisibleUsers } from '../lib/account-store.js'
import { canManageUsers } from '../lib/roles.js'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/login')
  }

  const projects = await listAccessibleProjects(user)
  const users = canManageUsers(user) ? await listVisibleUsers(user) : []

  return <AppHome initialUser={user} initialProjects={projects} initialUsers={users} />
}
