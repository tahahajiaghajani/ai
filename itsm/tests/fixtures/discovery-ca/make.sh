#!/bin/sh
# The fixture CA of the discovery tests (design A §17): a bank-like private root, a tool certificate it signs for
# tool.bank.test (and localhost), and an unrelated root that trusts nothing here. Test material only — the keys are
# public by being in the repository and must never be trusted outside the tests. Regenerate with:
#   sh tests/fixtures/discovery-ca/make.sh
set -e
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
days=10950
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/ca.key" -out ca.pem -days $days -subj "/CN=Kariz Test Bank Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout tool.key -out "$work/tool.csr" -subj "/CN=tool.bank.test" 2>/dev/null
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:tool.bank.test,DNS:localhost\n' > "$work/ext"
openssl x509 -req -in "$work/tool.csr" -CA ca.pem -CAkey "$work/ca.key" -CAcreateserial -out tool.pem -days $days -extfile "$work/ext" 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/other.key" -out other-ca.pem -days $days -subj "/CN=Kariz Test Unrelated Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
rm -f ca.srl
