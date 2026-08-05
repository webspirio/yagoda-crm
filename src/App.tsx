import { Shell } from '@/components/layout/Shell'
import { Toaster } from '@/components/ui/sonner'
import { useStore } from '@/lib/store'
import { ReceptionPage } from '@/pages/ReceptionPage'
import { DayPage } from '@/pages/DayPage'
import { PricesPage } from '@/pages/PricesPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { SupplierPage } from '@/pages/SupplierPage'
import { DebtsPage } from '@/pages/DebtsPage'
import { JournalPage } from '@/pages/JournalPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { PointsPage } from '@/pages/PointsPage'
import { RefsPage } from '@/pages/RefsPage'

export default function App() {
  const route = useStore((s) => s.route)

  return (
    <>
      <Shell>
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
      </Shell>
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}
