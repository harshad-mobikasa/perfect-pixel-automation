import { redirect } from 'next/navigation'
import AppHome from '../components/app-home'
import { getSessionUser } from '../lib/require-auth.js'
import { getAccountStore, listAccessibleProjects, publicUser } from '../lib/account-store.js'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/login')
  }

  const projects = await listAccessibleProjects(user)
  const users = user.role === 'admin' ? (await getAccountStore().listUsers()).map(publicUser) : []

  return <AppHome initialUser={user} initialProjects={projects} initialUsers={users} />
}
