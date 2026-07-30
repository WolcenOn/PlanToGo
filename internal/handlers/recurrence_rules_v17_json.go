package handlers

import "encoding/json"

func (input *occurrenceOverrideV17) UnmarshalJSON(data []byte) error {
	var payload struct {
		ActorEmail string `json:"actor_email"`
		StartsAt   string `json:"starts_at"`
		EndsAt     string `json:"ends_at"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	input.ActorEmail = payload.ActorEmail
	input.StartsAt = payload.StartsAt
	input.EndsAt = payload.EndsAt
	return nil
}
