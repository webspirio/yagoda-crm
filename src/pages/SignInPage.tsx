import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStore } from '@/lib/store'
import type { AuthResult } from '@/lib/types'

/**
 * Екран входу — ПЕРШИЙ вигляд поза `Shell` у цьому застосунку.
 *
 * Поза оболонкою він саме тому, що оболонка вже стверджує забагато: сайдбар малює
 * навігацію за роллю, шапка — імʼя й точку. Людини, яка не увійшла, ще немає, тому й
 * оболонки навколо неї бути не може (`App.tsx` тримає це інваріантом рендеру).
 *
 * ⚠️ СЕКРЕТУ СЮДИ НІЩО НЕ ПРИВОЗИТЬ. Демо-панель нижче будується з `users` зі знімка —
 * імʼя, роль, точка й логін там уже є, — а пароль стоїть у розмітці ЛІТЕРАЛОМ, який людина
 * набирає сама. `auth-mock.ts` експортує рівно одне імʼя (`authenticate`), і реекспорту
 * через стор теж немає: `seed:port` не бачить реекспортів, тому такий шлях був би саме тією
 * дірою, яку ця фаза закриває.
 *
 * Експортується РІВНО компонент: другий експорт із цього файлу дав би
 * `react/only-export-components`, а розширювати `overrides` у `.oxlintrc.json` заборонено.
 */
export function SignInPage() {
  const users = useStore((s) => s.users)
  const points = useStore((s) => s.points)
  const signIn = useStore((s) => s.signIn)

  const [login, setLogin] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [refused, setRefused] = React.useState<AuthResult | null>(null)

  const ready = login.trim() !== '' && secret !== ''

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    const res = signIn({ login, secret })
    // Успіх нічого не малює: `session` зʼявився, і `App` уже показує оболонку.
    if (res.ok) return
    setRefused(res)
    setSecret('')
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4">
      <div className="font-display text-[22px] leading-none font-semibold">Ягода</div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Вхід</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Під документами дня стоїть імʼя людини, яка їх зробила, — тому спершу треба сказати,
        хто за компʼютером.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signin-login">Логін</Label>
          <Input
            id="signin-login"
            className="h-11"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signin-secret">Пароль</Label>
          <Input
            id="signin-secret"
            className="h-11"
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>

        <Button type="submit" className="h-11" disabled={!ready}>
          Увійти
        </Button>

        {/*
          Три причини — три різні тексти. Зливати їх в одне «не вийшло» не можна: людині на
          точці треба знати, помилилася вона в логіні чи в паролі, а «логін є, а запису
          немає» — це взагалі не її помилка, а зламані дані (`23 §Р4-6`).
        */}
        {refused && !refused.ok ? (
          <p className="text-sm text-destructive">
            {refused.reason === 'unknown-login'
              ? 'Такого логіна немає. Логін короткий — назва точки або «owner»; перевірте розкладку.'
              : refused.reason === 'wrong-secret'
                ? 'Пароль не підходить. У демоверсії він один на всіх і показаний нижче.'
                : 'Логін є, а запису в реєстрі під ним немає — увійти ним нема ким. Скиньте демо-дані або зверніться до керівника.'}
          </p>
        ) : null}
      </form>

      <div className="mt-8 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        <div className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Демо-акаунти
        </div>
        <p className="mt-1 mb-2 text-[11px] leading-snug text-muted-foreground">
          Пароль в усіх один: <span className="font-mono">1111</span>. Натисніть рядок — логін
          підставиться, пароль наберіть самі.
        </p>
        <div className="flex flex-col gap-0.5">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setLogin(u.login)}
              className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span>
                {u.name}
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {u.role === 'owner'
                    ? 'керівник · усі точки'
                    : `приймальник · ${points.find((p) => p.id === u.pointId)?.name ?? '—'}`}
                </span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{u.login}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        Плашка каже про ДВІ речі, а не про одну: і пароль, і права тут перевіряє браузер.
        Написати лише «пароль ненадійний» означало б промовчати про друге — а саме друге
        робить цю перевірку демонстрацією механізму, а не захистом.
      */}
      <p className="mt-4 rounded-xl bg-muted p-3 text-[11px] leading-snug text-muted-foreground">
        У демоверсії і пароль, і права перевіряє браузер — цього досить, щоб показати
        механізм, але це не захист. У робочій системі те саме робить спільний сервер,
        однаковий для всіх точок; саме тому вхід під своїм імʼям їде разом зі спільною базою
        (розділ 17 ТЗ). Пароль у демо один на всіх і показаний тут же.
      </p>
    </div>
  )
}
