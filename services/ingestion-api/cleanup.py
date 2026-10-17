import asyncio, asyncpg, os
DATABASE_URL = os.environ["DATABASE_URL"]

async def main():
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Move alerts older than 90 days to archive
                res = await conn.execute("""
                    WITH moved AS (
                        DELETE FROM alerts WHERE time < now() - interval '90 days' RETURNING *
                    )
                    INSERT INTO archived_alerts SELECT * FROM moved;
                """)
                print(f"Archived old alerts: {res}")
    finally:
        await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
