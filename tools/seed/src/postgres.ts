import { getPostgresContext } from '@allmaps/db'
import { AllmapsShareDB } from '@allmaps/api-live'

import { seedDemoData } from './seed.ts'

// Seeds the demo dataset into the PostgreSQL database at DATABASE_URL, once.
// SEED_FIXTURE_ORIGINS lists the two fixture server origins the demo
// organizations serve their images from, separated by a comma.

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Missing DATABASE_URL')

const origins = process.env.SEED_FIXTURE_ORIGINS?.split(',')

const context = getPostgresContext(databaseUrl)
const shareDb = new AllmapsShareDB(context)

try {
  await seedDemoData(
    {
      client: {
        query: async (sql, params = []) => ({
          rows: Array.from(
            await context.sql.unsafe(sql, params as never[])
          ) as never[]
        }),
        exec: (sql) => context.sql.unsafe(sql)
      },
      db: context.db,
      shareDb
    },
    undefined,
    origins
  )
  console.log('Demo data ready')
} finally {
  await shareDb.close()
  await context.sql.end({ timeout: 5 })
}
