# GitHub Actions и проверки

## Workflow

| Workflow               | Файл                  | Когда запускается                    | Что делает                                                                                                                                                                            |
| ---------------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy to GitHub Pages | `deploy.yml`          | push в `main`                        | `npm ci`, `npm run build`, публикация `build/` в GitHub Pages. Не запускает и не ждёт проверок: сайт публикуется независимо от их результата.                                         |
| Frontend checks        | `frontend-checks.yml` | push в `main`, pull request в `main` | `npm run check` и `npm test` (исходные тесты, production-сборка, тесты сборки).                                                                                                       |
| ChatGPT branch check   | `chatgpt-check.yml`   | push в `*-chatgpt-check`, вручную    | `npm run check`.                                                                                                                                                                      |
| ChatGPT branch tests   | `chatgpt-tests.yml`   | push в `*-chatgpt-check`, вручную    | `npm test`.                                                                                                                                                                           |
| Build Bandito apps     | `build-apps.yml`      | push в `main`, вручную               | При push — публикация подписанного OTA-обновления веб-части. Вручную — сборки macOS и Android (`build_apps`) и/или OTA (`publish_ota`). Подробнее — [native-apps.md](native-apps.md). |

Все workflow используют Node.js 22.16 и `npm ci`. Проверки запускаются сами по push; ручной запуск в штатном процессе не нужен.

## Порядок работы

### С локальным клоном

Перед каждым коммитом — `npm run check` и `npm run test` в терминале клона; коммитится только код, который их проходит. После push в `main` Frontend checks повторяет те же проверки на сервере.

### Без среды запуска (ChatGPT с GitHub Plugin)

1. Изучить конфиги форматирования и актуальный HEAD `main`, внести завершённый набор изменений задачи в `main` и отправить его одним push.
2. Push сам публикует сайт (Deploy to GitHub Pages) и сам запускает Frontend checks на том же SHA. Вручную ничего запускать не нужно — только дождаться результата проверок.
3. Если проверки упали — взять логи из упавшего запуска Frontend checks в `main`, исправить ошибки и запушить исправления в ветку `*-chatgpt-check` (например, `main-chatgpt-check`) — копию `main` уже с исправлениями. Пустую копию без исправлений не пушить: это лишний прогон. Push в эту ветку параллельно запускает ChatGPT branch check и ChatGPT branch tests; если они снова упали — исправлять в той же ветке.
4. Когда обе проверки в ветке прошли — перенести исправления в `main`. Push в `main` автоматически запустит Frontend checks ещё раз для контроля; вручную его не запускать.

Не заявлять о локальном запуске проверок: указывать workflow и SHA, на котором они прошли.
