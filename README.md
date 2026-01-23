#include <nlohmann/json.hpp>
#include <iostream>
#include <map>
#include <string>

// Use nlohmann::ordered_json to preserve insertion order initially, 
// then pivot to a std::map for lexicographical enforcement.
using json = nlohmann::json;

std::string serialize_canonical_state(const std::map<std::string, float>& state_vector) {
    // std::map automatically sorts keys lexicographically (A-Z)
    json canonical_json;
    
    for (auto const& [key, value] : state_vector) {
        canonical_json[key] = value;
    }

    // dump( -1 ) ensures no extra whitespace or indentation for a compact hash surface
    return canonical_json.dump();
}
