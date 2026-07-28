package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

const tokenByteLength = 32

// NewToken returns a cryptographically secure token suitable for a magic link
// or session cookie. Only HashToken(token) should be stored in the database.
func NewToken() (string, error) {
	raw := make([]byte, tokenByteLength)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate secure token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// HashToken produces the fixed-size value stored in login_tokens and sessions.
func HashToken(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}
