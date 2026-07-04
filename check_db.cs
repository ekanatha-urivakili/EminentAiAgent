
using EminentAi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

var optionsBuilder = new DbContextOptionsBuilder<EminentAiDbContext>();
optionsBuilder.UseSqlite("Data Source=src/EminentAi.Api/eminentai.db");

using var db = new EminentAiDbContext(optionsBuilder.Options);
var users = await db.AdminUsers.ToListAsync();
Console.WriteLine($"Found {users.Count} users:");
foreach (var u in users)
{
    Console.WriteLine($"- {u.Email} ({u.FullName})");
}
