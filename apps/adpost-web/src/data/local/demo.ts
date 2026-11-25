import type { DemoApi } from '../contracts';
import { ValidationError } from '../errors';
import type { Scope } from './scope';
import { demoRowCounts, demoSpecForBrand, resetVcaDemo, VCA_DEMO_END } from './vcaDemo';

/** VCA demo dataset controls. Reset deletes only demo-owned rows (vd_<client>_ ids) of one client. */
export function localDemo(scope: Scope): DemoApi {
    const { db } = scope;
    const snap = () => ({ agencies: db.all('agencies'), brands: db.all('brands') }) as Parameters<typeof demoSpecForBrand>[0];
    return {
        async status(brandId) {
            scope.require(brandId, 'read');
            const spec = demoSpecForBrand(snap(), brandId);
            if (!spec) return { available: false, rows: 0, endDate: null };
            const counts = demoRowCounts(db.snapshot(), brandId);
            return { available: true, rows: Object.values(counts).reduce((a, b) => a + b, 0), endDate: VCA_DEMO_END };
        },
        async reset(brandId) {
            scope.require(brandId, 'admin');
            if (!demoSpecForBrand(snap(), brandId)) throw new ValidationError({ brand: 'This client has no demo dataset.' });
            const result = resetVcaDemo(db, brandId);
            scope.audit(brandId, 'demo.reset', 'brand', brandId);
            return result;
        },
    };
}
