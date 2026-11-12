"""NASA LANCE FIRMS Ingestion Adapter Package."""

from .firms_client import (
    BBOX_AMAZON,
    BBOX_INDIA,
    BBOX_INDIA_NORTH,
    BBOX_MEKONG,
    FIRMSClient,
    FIRMSQuerySpec,
    load_env_map_key,
)

__all__ = [
    "BBOX_AMAZON",
    "BBOX_INDIA",
    "BBOX_INDIA_NORTH",
    "BBOX_MEKONG",
    "FIRMSClient",
    "FIRMSQuerySpec",
    "load_env_map_key",
]

__author__ = "debbjitttt__ <rossdebb452@gmail.com>"
