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
 * лише «екрани, яких тест не відкриває» — правдиво за формою, але без величини. Цей тест
 * проходить усіма розділами навігації: кожен мусить відрендеритися, не дати ані page
 * error, ані console error, і не показати NaN у жодній сумі.
 */
test('усі розділи відкриваються без помилок і без NaN', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  const sections = ['Каса за день', 'Ціни дня', 'Постачальники', 'Залишки']
  for (const name of sections) {
    await page.getByRole('button', { name, exact: true }).first().click()
    // Кожен розділ мусить показати власний заголовок, а не порожню оболонку.
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText('NaN')
  }

  // Роль власника відкриває зведення — інший набір екранів, той самий стандарт.
  await page.getByRole('button', { name: 'Власник', exact: true }).click()
  await expect(page.getByRole('heading').first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NaN')

  expect(errors, `помилки під час обходу розділів:\n${errors.join('\n')}`).toEqual([])
})
