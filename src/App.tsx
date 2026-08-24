import * as React from 'react'
import { Shell } from '@/components/layout/Shell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { useStore } from '@/lib/store'
import { ReceptionPage } from '@/pages/ReceptionPage'
import { DayPage } from '@/pages/DayPage'
import { PricesPage } from '@/pages/PricesPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { SupplierPage } from '@/pages/SupplierPage'
import { DebtsPage } from '@/pages/DebtsPage'

/*
 * ЩО ТУТ ЛІНИВЕ І ЧОМУ САМЕ ЦЕ.
 *
 * Ціль зміряна, не вгадана: `recharts` імпортує РІВНО один файл — `components/ui/chart.tsx`,
 * а його імпортує РІВНО один екран — `DashboardPage`. Тобто вся бібліотека графіків заходила
 * в перший чанк через один розділ, доступний лише власникові, і приймальник на точці
 * завантажував її на мобільному інтернеті, ніколи не відкриваючи.
 *
 * У ПЕРШОМУ чанку лишаються шість екранів, за якими приймальник сидить постійно: прийомка,
 * каса за день, ціни дня, постачальники, картка постачальника, залишки. Ділити їх означало б
 * платити мережевим запитом за перший же перехід у звичайній роботі.
 *
 * `Sparkline` до `recharts` відношення не має (власний SVG) і лишається як був.
 *
 * СУМА `dist/assets` від розділення НЕ зменшується — на межах чанків навіть трохи додає.
 * Ціль тут ПЕРШИЙ чанк, а не сума; бюджет у `baselines/bundle-budget.json` міряє саме суму,
 * тому його стеля — окреме, видиме рішення, і в цій зміні вона не рухається.
 */
const JournalPage = React.lazy(() =>
  import('@/pages/JournalPage').then((m) => ({ default: m.JournalPage })),
)
const DashboardPage = React.lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const PointsPage = React.lazy(() =>
  import('@/pages/PointsPage').then((m) => ({ default: m.PointsPage })),
)
const RefsPage = React.lazy(() =>
  import('@/pages/RefsPage').then((m) => ({ default: m.RefsPage })),
)
const CostOfDayPage = React.lazy(() =>
  import('@/pages/CostOfDayPage').then((m) => ({ default: m.CostOfDayPage })),
)
const ReweighPage = React.lazy(() =>
  import('@/pages/ReweighPage').then((m) => ({ default: m.ReweighPage })),
)
const NetworkAveragePage = React.lazy(() =>
  import('@/pages/NetworkAveragePage').then((m) => ({ default: m.NetworkAveragePage })),
)
const OwnerSheetPage = React.lazy(() =>
  import('@/pages/OwnerSheetPage').then((m) => ({ default: m.OwnerSheetPage })),
)

/**
 * НОВИЙ РЕЖИМ ВІДМОВИ, ЯКОГО ДО CODE SPLITTING НЕ ІСНУВАЛО — тому він наш.
 *
 * Провалений `import()` дає **білий екран без жодного слова**: офлайн на точці, або редеплой
 * Pages при відкритій вкладці (хеші чанків міняються, і старий `NetworkAveragePage-BV4u.js`
 * зникає з сервера). До розділення чанків такого стану не було зовсім — уся сторінка приходила
 * одним файлом разом із оболонкою.
 *
 * Класовий компонент, бо хуків для `componentDidCatch` у React 19 досі немає. Живе В ЦЬОМУ Ж
 * ФАЙЛІ навмисно: окремий файл дав би експорт без імпортера, і `deadcode` показав би його
 * знахідкою — позеленіти дописуванням у baseline тут не варіант.
 *
 * Жодної телеметрії й жодних залежностей: відправляти нікуди, сервера немає.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Не вдалося завантажити розділ — перевірте зʼєднання і оновіть сторінку.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Оновити
        </Button>
      </div>
    )
  }
}

/**
 * Тихий каркас на час завантаження чанка. Навмисно НЕ «Завантаження…» на пів екрана:
 * на швидкій мережі чанк приходить за десятки мілісекунд, і текст-заглушка встигла б
 * блимнути — це виглядає як помилка, а не як робота.
 */
function PageFallback() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export default function App() {
  const route = useStore((s) => s.route)

  return (
    <>
      <Shell>
        {/*
          `key={route.name}` не косметика: без нього ErrorBoundary, який один раз упав,
          лишався б у стані `failed` і на всіх наступних розділах теж — тобто одна недоїхана
          сторінка вішала б увесь застосунок до перезавантаження. Зміна ключа монтує межу
          заново, і перехід у сусідній розділ сам себе лікує.
        */}
        <ErrorBoundary key={route.name}>
          <React.Suspense fallback={<PageFallback />}>
            {route.name === 'reception' && <ReceptionPage />}
            {route.name === 'day' && <DayPage />}
            {route.name === 'prices' && <PricesPage />}
            {route.name === 'suppliers' && <SuppliersPage />}
            {route.name === 'supplier' && <SupplierPage id={route.id!} />}
            {route.name === 'debts' && <DebtsPage />}
            {route.name === 'journal' && <JournalPage />}
            {route.name === 'dashboard' && <DashboardPage />}
            {route.name === 'points' && <PointsPage />}
            {route.name === 'refs' && <RefsPage />}
            {route.name === 'cost' && <CostOfDayPage />}
            {route.name === 'reweigh' && <ReweighPage />}
            {route.name === 'network' && <NetworkAveragePage />}
            {route.name === 'sheet' && <OwnerSheetPage />}
          </React.Suspense>
        </ErrorBoundary>
      </Shell>
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}
