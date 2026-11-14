import { login } from '../actions.ts'

export default async function Login({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams
  return (
    <form action={login} className="card mx-auto mt-16 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-bold">Anmelden</h1>
      <input type="hidden" name="next" value={typeof sp.next === 'string' ? sp.next : '/'} />
      <input type="password" name="password" placeholder="Passwort" autoFocus required />
      {sp.fehler ? <p className="text-sm text-bad">Falsches Passwort.</p> : null}
      <button className="btn w-full justify-center">Weiter</button>
    </form>
  )
}
