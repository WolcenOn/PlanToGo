package auth

import (
	"encoding/base64"
	"testing"
)

func TestNewTokenProducesRandomURLSafeValues(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken() second error = %v", err)
	}
	if first == second {
		t.Fatal("NewToken() returned the same value twice")
	}

	decoded, err := base64.RawURLEncoding.DecodeString(first)
	if err != nil {
		t.Fatalf("token is not raw URL-safe base64: %v", err)
	}
	if len(decoded) != tokenByteLength {
		t.Fatalf("decoded token length = %d, want %d", len(decoded), tokenByteLength)
	}
}

func TestHashTokenIsDeterministicAndDoesNotExposeToken(t *testing.T) {
	token := "example-secret-token"
	first := HashToken(token)
	second := HashToken(token)
	if first != second {
		t.Fatal("HashToken() is not deterministic")
	}
	if string(first[:]) == token {
		t.Fatal("HashToken() returned the plain token")
	}
}
