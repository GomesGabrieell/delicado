import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDocument, validDocument, validateClient } from '../src/clients/model.ts';

const fields = { name: ' Cliente ', document: null, whatsapp: null, email: null, address: null, notes: null };

test('valida CPF, CNPJ numérico e CNPJ alfanumérico', () => {
  for (const document of ['529.982.247-25', '11.222.333/0001-81', '12.ABC.345/01DE-35']) {
    assert.equal(validDocument(normalizeDocument(document)), true);
  }
});

test('rejeita dígitos incorretos, documentos repetidos e caracteres inválidos', () => {
  for (const document of ['52998224726', '11111111111', '12ABC34501DE36', '12@ABC34501DE35', '00000000000000']) {
    assert.equal(validDocument(document), false);
  }
});

test('normaliza dados opcionais e valida contato', () => {
  assert.deepEqual(validateClient({ ...fields, whatsapp: '+55 (11) 99999-9999', document: '12.abc.345/01de-35' }), {
    ...fields, name: 'Cliente', whatsapp: '+5511999999999', document: '12ABC34501DE35',
  });
  assert.throws(() => validateClient({ ...fields, document: '---' }), /CPF/);
  assert.throws(() => validateClient({ ...fields, whatsapp: '123' }), /WhatsApp/);
  assert.throws(() => validateClient({ ...fields, email: 'inválido' }), /e-mail/);
});
