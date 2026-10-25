import { LocalBackend } from '@/data/local/backend';
import { DEV_PASSWORD } from '@/data/local/fixtures';
import { testDb } from '@/test/helpers';
import { runBackendContract } from './backendContract';

// Phase 17: add `supabase.contract.test.ts` calling runBackendContract against a seeded staging project.
runBackendContract('local adapter', () => new LocalBackend(testDb()), {
    password: DEV_PASSWORD,
    emails: {
        podOwner: 'priya@pod.example.test',
        podViewer: 'vic@pod.example.test',
        podClient: 'casey@client.example.test',
        dmdManager: 'dana@dmd.example.test',
    },
});
