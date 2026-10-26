import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, ErrorState, Field, Input, Textarea } from '@/components/ui';
import { fieldErrors, useAction } from '@/app/backend';

export function CreateBrandDialog({ onClose }: { onClose: () => void }) {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState('#4f46e5');
    const create = useAction((api) => api.workspace.createBrand({ name, description, color }));
    const errors = fieldErrors(create.error);

    return (
        <Dialog
            open
            title="New brand"
            onClose={onClose}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        loading={create.pending}
                        onClick={async () => {
                            const brand = await create.run();
                            if (brand) navigate(`/b/${brand.slug}/settings`);
                        }}
                    >
                        Create brand
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                {create.error && !Object.keys(errors).length ? <ErrorState error={create.error} /> : null}
                <Field id="new-brand-name" label="Brand name" required>
                    <Input id="new-brand-name" value={name} error={errors.name ?? errors.slug} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field id="new-brand-description" label="Description">
                    <Textarea id="new-brand-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <Field id="new-brand-color" label="Brand color">
                    <Input id="new-brand-color" type="color" className="h-10 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
                </Field>
                <p className="text-xs text-fg-muted">
                    The brand starts with no websites, members or knowledge, plus its own independent set of the six specialist AI agents. Agency staff can access it straight away.
                </p>
            </div>
        </Dialog>
    );
}
