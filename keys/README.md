# Trusted signing keys

The site lists a result only if it is signed by a key in this folder (`<key_id>.pub`, PEM).
The key id is the first 16 hex characters of the SHA-256 of the raw public key.

- `478df5eb628bfa74.pub` is the hosted runner's production key. Its private key lives only in
  GCP Secret Manager (`signing-key`).

Never put a private key (`.key`) in this repository.
