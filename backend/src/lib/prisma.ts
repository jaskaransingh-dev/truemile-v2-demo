// Re-export the shared Prisma singleton from services/db.ts
// All route files should import from here or from '../services/db'
export { prisma } from '../services/db';
export default undefined; // no default export needed
