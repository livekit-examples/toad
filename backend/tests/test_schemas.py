import pytest
from pydantic import ValidationError

from dots_backend.schemas import ReservationPayload, TaskSchema


def test_reservation_payload_accepts_valid_e164_and_camel_case_wire_format():
    payload = ReservationPayload.model_validate(
        {
            "businessName": "Luigi's",
            "phone": "+14155552671",
            "dateTime": "2026-10-01T18:00:00-07:00",
            "partySize": 2,
            "reservationName": "Chad",
        }
    )
    assert payload.business_name == "Luigi's"
    assert payload.model_dump(by_alias=True)["partySize"] == 2


@pytest.mark.parametrize("phone", ["5550001111", "+0155500011", "not-a-phone"])
def test_reservation_payload_rejects_non_e164_phone(phone):
    with pytest.raises(ValidationError):
        ReservationPayload(
            business_name="Luigi's",
            phone=phone,
            date_time="2026-10-01T18:00:00-07:00",
            party_size=2,
            reservation_name="Chad",
        )


def test_reservation_payload_rejects_non_positive_party_size():
    with pytest.raises(ValidationError):
        ReservationPayload(
            business_name="Luigi's",
            phone="+14155552671",
            date_time="2026-10-01T18:00:00-07:00",
            party_size=0,
            reservation_name="Chad",
        )


def test_task_schema_serializes_str_enums_and_camel_case():
    dump = TaskSchema.model_construct(
        id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        type="RESERVATION_CALL",
        status="QUEUED",
        title="Table for 2",
        payload=ReservationPayload(
            business_name="Luigi's",
            phone="+14155552671",
            date_time="2026-10-01T18:00:00-07:00",
            party_size=2,
            reservation_name="Chad",
        ),
        result=None,
        callback={"channel": "NONE", "when": "ON_SUCCESS", "to": None},
        callback_status="PENDING",
        error=None,
        created_at="2026-09-30T00:00:00+00:00",
        started_at=None,
        finished_at=None,
        updated_at="2026-09-30T00:00:00+00:00",
    ).model_dump(mode="json", by_alias=True)
    assert dump["userId"] == "22222222-2222-2222-2222-222222222222"
    assert dump["callbackStatus"] == "PENDING"
    assert isinstance(dump["status"], str)
