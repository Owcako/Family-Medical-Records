"""Exact family identity matching; no fuzzy guesses about patient names."""


def normalized_name(value):
    return " ".join(value.split()).casefold()


def match_profile(value, profiles):
    name = normalized_name(value)
    matches = [profile for profile in profiles if name in
               [normalized_name(item) for item in [profile["name"], *profile["aliases"]]]]
    return matches[0] if name and len(matches) == 1 else None
