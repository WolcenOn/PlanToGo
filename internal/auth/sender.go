package auth

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
)

type SMTPOptions struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
}

type SMTPSender struct {
	options SMTPOptions
}

func NewSMTPSender(options SMTPOptions) *SMTPSender {
	return &SMTPSender{options: options}
}

func (s *SMTPSender) SendMagicLink(ctx context.Context, user User, link string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	from, err := mail.ParseAddress(s.options.From)
	if err != nil {
		return fmt.Errorf("invalid SMTP_FROM: %w", err)
	}
	address := net.JoinHostPort(s.options.Host, s.options.Port)
	var smtpAuth smtp.Auth
	if s.options.Username != "" {
		smtpAuth = smtp.PlainAuth("", s.options.Username, s.options.Password, s.options.Host)
	}

	subject := "Tu enlace de acceso a PlanToGo"
	body := fmt.Sprintf("Hola %s,\r\n\r\nAbre este enlace para acceder a PlanToGo:\r\n%s\r\n\r\nEl enlace caduca en 15 minutos y solo puede utilizarse una vez.\r\n", user.Name, link)
	message := strings.Join([]string{
		"From: " + s.options.From,
		"To: " + user.Email,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	if err := smtp.SendMail(address, smtpAuth, from.Address, []string{user.Email}, []byte(message)); err != nil {
		return fmt.Errorf("send magic link email: %w", err)
	}
	return nil
}

type LogSender struct {
	logger *slog.Logger
}

func NewLogSender(logger *slog.Logger) *LogSender {
	return &LogSender{logger: logger}
}

func (s *LogSender) SendMagicLink(ctx context.Context, user User, link string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	s.logger.Warn("development magic link", "user_id", user.ID, "email", user.Email, "link", link)
	return nil
}
