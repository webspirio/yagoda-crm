import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * What `build` cannot tell you: whether the artifact runs.
 *
 * This drives the *built* bundle, served under the production base path `/yagoda-crm/`,
 * through one whole visit — weight, сорт, «Разом», Прийняти — and fails on any page
 * error or console error along the way. A build that compiles and then throws on first
 * render is green in `build` and red here, which is the entire point of the row.
 */

/** Console noise that is not evidence of a broken app. Kept deliberately tiny. */
const IGNORABLE = [
  /favicon/i,
  // React DevTools nag, printed as info on some builds
  /Download the React DevTools/i,
]

/**
 * Attaches error collection before the first navigation, so a throw during initial
 * render is caught rather than missed.
 */
function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (IGNORABLE.some((r) => r.test(text))) return
    errors.push(`console.error: ${text}`)
  })
  return errors
}

test('зібраний артефакт піднімається під /yagoda-crm/ без помилок', async ({ page }) => {
  const errors = collectErrors(page)

  const response = await page.goto('./', { waitUntil: 'domcontentloaded' })
  expect(response?.status(), 'preview має віддати 200 під базовим шляхом').toBe(200)

  // If the base path were wrong the HTML would still load and every asset would 404,
  // leaving an empty shell — so assert on rendered content, not on the response alone.
  await expect(page.getByRole('heading', { name: 'Прийомка ягоди' })).toBeVisible()

  expect(errors, `помилки на старті:\n${errors.join('\n')}`).toEqual([])
})

test('один візит проходить від ваги до «Разом»', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Прийомка ягоди' })).toBeVisible()

  // 1 · постачальник — тригер має role="combobox", не button
  const picker = page.getByRole('combobox').filter({ hasText: 'Обрати постачальника' })
  await picker.click()
  await expect(page.getByPlaceholder('Прізвище або село…')).toBeVisible()
  const firstSupplier = page.getByRole('option').first()
  await expect(firstSupplier).toBeVisible()
  await firstSupplier.click()
  // прізвища беремо з seed через .first(), а не літералом: інакше тест ламається
  // від будь-якої зміни довідника, і його почнуть «лагодити» ослабленням перевірок
  await expect(picker).toHaveCount(0)

  // 2 · вага з тарою. Тара обовʼязкова: ReceptionPage тримає «Прийняти» вимкненою,
  // поки tareUnits === 0, бо інакше брутто пішло б у чисту вагу цілком.
  await page.locator('#gross').fill('120,50')
  await page.getByRole('button', { name: '+10 ящ.' }).click()

  // 3 · сорт із цінами дня — беремо перший доступний
  const berry = page.getByRole('button', { name: /₴\/кг$/ }).first()
  await expect(berry).toBeVisible()
  await berry.click()

  // 4 · «Разом» мусить перестати бути нулем.
  //
  // Раніше тут стояло `expect(getByText('Разом до видачі')).toBeVisible()` з коментарем
  // «саме тут падає збірка, яка рахує NaN». Це було неправдою: «Разом до видачі» — це
  // статичний <Eyebrow> (ReceptionPage.tsx:829), а сума живе в сусідньому <span>, і
  // uah(NaN) друкує рівно «NaN ₴». Тобто перевірка не могла впасти з тієї причини, яку
  // сама називала. Тепер перевіряється сама цифра.
  const totalBlock = page.getByText('Разом до видачі').locator('..')
  await expect(totalBlock).toBeVisible()
  await expect(totalBlock).not.toContainText('NaN')
  expect(
    await totalBlock.innerText(),
    '«Разом» мусить містити ненульову цифру, а не 0,00 і не NaN',
  ).toMatch(/[1-9]/)
  // Ширша сітка на весь екран: NaN у будь-якій сумі — це та сама поломка.
  await expect(page.locator('body')).not.toContainText('NaN')

  const accept = page.getByRole('button', { name: /^Прийняти/ })
  await expect(accept).toBeEnabled()
  await accept.click()

  // квитанція візиту відкривається одразу після прийомки
  await expect(page.getByRole('dialog')).toBeVisible()

  expect(errors, `помилки під час візиту:\n${errors.join('\n')}`).toEqual([])
})

/**
 * Раніше smoke відкривав рівно один екран із десяти, а blindSpot у registry казав про це
 * лише «екрани, яких тест не відкриває» — правдиво за формою, але без величини.
 *
 * Назва цього тесту раніше казала «усі розділи», і це було ширше за сам тест. Тому і назва,
 * і опис у registry перелічують РІВНО те, що обходиться: ТРИНАДЦЯТЬ відкриттів розділу,
 * різних розділів ДВАНАДЦЯТЬ («Постачальники» відкриваються двічі — під обома ролями, і це
 * навмисно). Шість приймальникових, роль власника і шість під нею. У навігації розділів
 * шістнадцять (Shell.tsx:53-86), приймальникові з них видно сім.
 *
 * Поза обходом лишаються «Журнал», «Точки», «Тара і сорти» і картка постачальника;
 * «Прийомка» відкривається двома тестами вище.
 *
 * Стандарт для кожного розділу той самий: власний заголовок сторінки видимий, ані page
 * error, ані console error, і жодного «NaN» у тексті сторінки.
 */
test('розділи приймальника й керівника відкриваються без помилок і без NaN', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  const sections = ['Каса за день', 'Ціни дня', 'Постачальники', 'Залишки']
  for (const name of sections) {
    await page.getByRole('button', { name, exact: true }).first().click()
    // Кожен розділ мусить показати власний заголовок, а не порожню оболонку.
    // Тут чекається БУДЬ-ЯКИЙ заголовок, а не назва екрана, і це не недогляд: у цих
    // чотирьох підпис у навігації не дорівнює <h1> («Каса за день» → «Каса за <дата>»).
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText('NaN')
  }

  // Клік по навігації, а не по сторінці: назва розділу може стояти й у тексті екрана
  // (напр. «Собівартість дня» у підказці на «Переважуванні»), і page-level пошук тоді
  // або впаде на strict mode, або клікне не туди.
  const nav = page.getByRole('navigation')

  /*
   * «Ящики» і «Каса точки» — розділи фаз 5-6, обидва доступні приймальникові. Обидва лежать
   * у ГОЛОВНОМУ чанку (App.tsx:24-29 їх навмисно не лінить: на точці вони відкриваються по
   * кілька разів на день), тому очікування заголовка тут — не очікування мережі.
   *
   * Різниця з чотирма вище: у цих двох підпис у навігації дослівно дорівнює <h1>, який малює
   * PageHeader (CratesPage.tsx:83, PointCashPage.tsx:92), тому заголовок шукається ПО ІМЕНІ.
   * Збіг доводить, що відкрився саме той екран, а не будь-який непорожній.
   */
  await nav.getByRole('button', { name: 'Ящики', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ящики', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NaN')

  /*
   * ЄДИНА В УСЬОМУ ОБХОДІ ПЕРЕВІРКА КОНКРЕТНОГО ЧИСЛА — і читати її треба саме так.
   *
   * Решта дванадцяти відкриттів доводять рендер, відсутність помилок і відсутність «NaN»;
   * жодної суми на жодному іншому екрані цей файл не перевіряє. Навіть тест візиту вище
   * стверджує лише «не нуль і не NaN», а не рівність конкретній сумі. Тобто зелений обхід
   * НЕ означає, що числа на екранах правильні — він означає, що екрани відкрилися.
   *
   * Перевіряється тотожність складу наділу зі смужки (CrateStandingBar.tsx:89-93):
   * 800 = 341 + 195 + 264 — наділ, пустих на точці, у людей, у нас з ягодою. Чотири числа
   * взяті з наскрізного прикладу клієнтки (docs/21 §8.4, Шипинки 04.08.2026), а не з коду,
   * і той самий рядок стоїть у юніт-тестах рушія (crates.test.ts:370). Тут він доводить
   * інше: що зібраний артефакт довозить ці числа до пікселів на екрані.
   *
   * Локатор шукає рядок ЗА ФОРМОЮ (`\d+ = \d+ + \d+ + \d+`), а числа звіряє toHaveText —
   * інакше зміна складу наділу давала б «елемент не знайдено» замість читабельної різниці.
   */
  const standingIdentity = page.getByText(/^\d+ = \d+ \+ \d+ \+ \d+$/)
  await expect(
    standingIdentity,
    'смужка складу наділу мусить показувати 800 = 341 + 195 + 264 (docs/21 §8.4)',
  ).toHaveText('800 = 341 + 195 + 264')

  await nav.getByRole('button', { name: 'Каса точки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Каса точки', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NaN')

  /*
   * Далі — розділи керівника, і тут з'являється те, чого в чотирьох вище немає: КОЖЕН із
   * них приходить окремим чанком через React.lazy (App.tsx:36-63), а на час завантаження
   * Suspense малює каркас зі Skeleton і без жодного заголовка. Тому:
   *
   *   1. чекаємо саме на заголовок (`toBeVisible` з явним таймаутом на мережевий запит за
   *      чанком), а не читаємо DOM одразу після кліку;
   *   2. перевірку «немає NaN» робимо ПІСЛЯ того, як заголовок видимий — інакше вона
   *      міряла б каркас, у якому тексту немає взагалі, і зеленіла б ні про що.
   *
   * Заголовок шукається ПО ІМЕНІ розділу, а не `heading.first()` навмання: підпис у
   * навігації (Shell.tsx:66-72) дослівно дорівнює <h1>, який малює PageHeader
   * (bits.tsx:32), тому збіг доводить, що відкрився саме той екран, а не будь-який.
   */
  const CHUNK = 15_000

  // Перемикач ролі — це не просто фільтр навігації: setRole кидає маршрут на «Зведення»
  // (store.ts:91-96), а це вже ленивий чанк.
  await page.getByRole('button', { name: 'Власник', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Зведення по сезону', exact: true })).toBeVisible({
    timeout: CHUNK,
  })
  await expect(page.locator('body')).not.toContainText('NaN')

  // Підписи — дослівно з Shell.tsx. Перші пʼять з групи «Керівництву»: два прийшли з фазою 2,
  // два з фази 3, «Перекази» — з фази 6.
  //
  // «Постачальники» — шості й особливі, тому вони тут, а не в циклі приймальника вище.
  // Розділ той самий (група «Люди та гроші», роль обидві), але КОМПОНЕНТ під власником
  // інший: SuppliersPage малює OwnerTable (`SuppliersPage.tsx`) — шість колонок із маркером
  // і сумою замість приймальникового списку. Під приймальником цей екран уже відкривався
  // вище, тобто саме керівницький вигляд був єдиним екраном фази 3, якого не рендерив
  // жоден тест. Конфлікту strict mode це не дає: локатор `nav` бере кнопку в навігації, а
  // не на сторінці, і кнопка там одна на роль.
  //
  // Різниця з першими пʼятьма, яку не варто забувати: ці пʼять приходять окремим чанком
  // через React.lazy, а SuppliersPage лежить у головному чанку (App.tsx її не лінить), тому
  // для неї очікування заголовка — не очікування мережі. Стандарт перевірки той самий.
  //
  // «Перекази» — розділ фази 6 і теж ленивий чанк (App.tsx:60-63), причому єдиний, який
  // приймальник не завантажує ЖОДНОГО разу: у Shell.tsx:84 він доступний лише власникові.
  const ownerSections = [
    'Собівартість дня',
    'Переважування',
    'Середня ціна по мережі',
    'Аркуш керівника',
    'Перекази',
    'Постачальники',
  ]
  // `nav` оголошений вище, перед приймальниковими «Ящиками»: клік по навігації, а не по
  // сторінці, потрібен в обох половинах обходу з тієї самої причини.
  for (const name of ownerSections) {
    await nav.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: CHUNK })
    await expect(page.locator('body')).not.toContainText('NaN')
  }

  expect(errors, `помилки під час обходу розділів:\n${errors.join('\n')}`).toEqual([])
})
